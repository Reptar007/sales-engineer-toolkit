/**
 * The Task Wolf MCP client speaks JSON-RPC over HTTP with a fake fetch, so
 * these pin the protocol details that would otherwise only fail in production:
 * the handshake, JSON and SSE answers, auth failures, tool errors and the
 * session-id dance.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKEN_EXPIRY_WARNING_DAYS,
  TaskWolfAuthError,
  TaskWolfForbiddenError,
  TaskWolfToolError,
  createTaskWolfClient,
  getTaskWolfMcpUrl,
  getTaskWolfTokenExpiresOn,
  getTaskWolfTokenExpiry,
  isTaskWolfConfigured,
  parseSseBody,
  parseToolResult,
} from '../src/projects/maintenance-dashboard/taskWolfMcpClient.js';

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const all = { 'content-type': 'application/json', ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => all[name.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function sseResponse(messages, { status = 200 } = {}) {
  const body = messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join('');
  return {
    ok: true,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null),
    },
    text: async () => body,
  };
}

/** A fake server: records every request and answers by method. */
function fakeServer({ tools = [], onCall, sse = false, sessionId = null } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const message = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, message });
    const reply = (result) => {
      const envelope = { jsonrpc: '2.0', id: message.id, result };
      return sse
        ? sseResponse([envelope])
        : jsonResponse(envelope, { headers: sessionId ? { 'mcp-session-id': sessionId } : {} });
    };
    switch (message.method) {
      case 'initialize':
        return reply({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'task-wolf', version: '1.0.0' },
        });
      case 'notifications/initialized':
        return jsonResponse(undefined, { status: 202 });
      case 'tools/list':
        return reply({ tools });
      case 'tools/call':
        return onCall(message, reply);
      default:
        return jsonResponse({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'no such method' },
        });
    }
  };
  return { requests, fetchImpl };
}

/**
 * A fake server that keeps sessions, the way a stateful MCP server would:
 * every `initialize` hands out the next id, a request under an id it no longer
 * knows is a 404 and one with no id at all a 400. `forget()` drops every
 * session; `hold(customer)` parks the answer to that customer's next call and
 * returns the function that lets it go, so a test decides what lands when.
 */
function sessionServer({ tools = [], alwaysStale = false } = {}) {
  const requests = [];
  const live = new Set();
  const held = new Map();
  let issued = 0;
  const fetchImpl = async (url, init) => {
    const message = JSON.parse(init.body);
    const session = init.headers['Mcp-Session-Id'] || null;
    const customer = message.params?.arguments?.customer;
    requests.push({ method: message.method, session, customer });
    if (message.method === 'initialize') {
      issued += 1;
      live.add(`sess-${issued}`);
      return jsonResponse(
        { jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: 'task-wolf' } } },
        { headers: { 'mcp-session-id': `sess-${issued}` } },
      );
    }
    const reply = (result) =>
      jsonResponse(
        { jsonrpc: '2.0', id: message.id, result },
        { headers: { 'mcp-session-id': session } },
      );
    // Decided on arrival, so an answer parked below keeps the verdict of its time.
    let answer;
    if (!session) {
      answer = jsonResponse({ error: 'Mcp-Session-Id header is required' }, { status: 400 });
    } else if (!live.has(session) || (alwaysStale && message.method === 'tools/call')) {
      answer = jsonResponse({ error: 'Session not found' }, { status: 404 });
    } else if (message.method === 'notifications/initialized') {
      answer = jsonResponse(undefined, { status: 202 });
    } else if (message.method === 'tools/list') {
      answer = reply({ tools });
    } else {
      answer = reply({ structuredContent: { customer, session } });
    }
    const parked = held.get(customer);
    if (parked) {
      held.delete(customer);
      await parked;
    }
    return answer;
  };
  return {
    requests,
    fetchImpl,
    forget: () => live.clear(),
    hold(customer) {
      let release;
      held.set(
        customer,
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      return release;
    },
    count: (method) => requests.filter((r) => r.method === method).length,
  };
}

describe('config', () => {
  test('url defaults to the production MCP and trims trailing slashes', () => {
    assert.equal(getTaskWolfMcpUrl({}), 'https://task-wolf.com/apis/task-wolf/mcp');
    assert.equal(
      getTaskWolfMcpUrl({ TASK_WOLF_MCP_URL: 'http://localhost:3000/mcp/' }),
      'http://localhost:3000/mcp',
    );
    assert.equal(isTaskWolfConfigured({}), false);
    assert.equal(isTaskWolfConfigured({ TASK_WOLF_MCP_TOKEN: ' twmcp_x ' }), true);
  });

  test('the expiry date is read as set, trimmed, and null when unset', () => {
    assert.equal(getTaskWolfTokenExpiresOn({}), null);
    assert.equal(getTaskWolfTokenExpiresOn({ TASK_WOLF_MCP_TOKEN_EXPIRES_ON: '   ' }), null);
    assert.equal(
      getTaskWolfTokenExpiresOn({ TASK_WOLF_MCP_TOKEN_EXPIRES_ON: ' 2026-10-12 ' }),
      '2026-10-12',
    );
    // Not a date, but it is what was set; the expiry is what calls it invalid.
    assert.equal(
      getTaskWolfTokenExpiresOn({ TASK_WOLF_MCP_TOKEN_EXPIRES_ON: 'next month' }),
      'next month',
    );
  });
});

describe('getTaskWolfTokenExpiry', () => {
  const env = (expiresOn) => ({
    TASK_WOLF_MCP_TOKEN: 'twmcp_test',
    TASK_WOLF_MCP_TOKEN_EXPIRES_ON: expiresOn,
  });
  const at = (t, iso) => t.mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });

  test('warns from 14 days out through the day itself, and is expired from the next day', (t) => {
    assert.equal(TOKEN_EXPIRY_WARNING_DAYS, 14);
    const cases = [
      ['2026-09-27T00:00:00.000Z', 15, 'ok'],
      ['2026-09-27T23:59:59.999Z', 15, 'ok'],
      ['2026-09-28T00:00:00.000Z', 14, 'expiring'],
      ['2026-10-11T12:00:00.000Z', 1, 'expiring'],
      // The token works through the day it expires on.
      ['2026-10-12T00:00:00.000Z', 0, 'expiring'],
      ['2026-10-12T23:59:59.999Z', 0, 'expiring'],
      ['2026-10-13T00:00:00.000Z', -1, 'expired'],
      ['2026-12-01T09:00:00.000Z', -50, 'expired'],
    ];
    for (const [now, daysLeft, state] of cases) {
      at(t, now);
      assert.deepEqual(
        getTaskWolfTokenExpiry(env('2026-10-12')),
        { expiresOn: '2026-10-12', daysLeft, state },
        now,
      );
      t.mock.timers.reset();
    }
  });

  test('counts days in UTC, whatever the time of day where the server is', (t) => {
    // The zone is set here, since CI runs in UTC, where local midnight is UTC's.
    const zone = process.env.TZ;
    t.after(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });
    // 8 PM on the 12th in Chicago is already the 13th in UTC.
    process.env.TZ = 'America/Chicago';
    at(t, '2026-10-13T01:00:00.000Z');
    assert.equal(getTaskWolfTokenExpiry(env('2026-10-12')).state, 'expired');
    t.mock.timers.reset();
    // And 1 AM on the 13th in Tokyo is still the 12th.
    process.env.TZ = 'Asia/Tokyo';
    at(t, '2026-10-12T16:00:00.000Z');
    assert.equal(getTaskWolfTokenExpiry(env('2026-10-12')).daysLeft, 0);
  });

  test('is none with no date, or no token to date', (t) => {
    at(t, '2026-09-28T18:00:00.000Z');
    const none = { expiresOn: null, daysLeft: null, state: 'none' };
    assert.deepEqual(getTaskWolfTokenExpiry({}), none);
    assert.deepEqual(getTaskWolfTokenExpiry({ TASK_WOLF_MCP_TOKEN: 'twmcp_test' }), none);
    assert.deepEqual(getTaskWolfTokenExpiry(env('  ')), none);
    assert.deepEqual(
      getTaskWolfTokenExpiry({ TASK_WOLF_MCP_TOKEN_EXPIRES_ON: '2026-10-12' }),
      none,
    );
  });

  test('is invalid for anything but a real YYYY-MM-DD, and never repeats what was set', (t) => {
    at(t, '2026-09-28T18:00:00.000Z');
    const invalid = { expiresOn: null, daysLeft: null, state: 'invalid' };
    for (const value of [
      'next month',
      'twmcp_pasted_in_the_wrong_place',
      '10/12/2026',
      '2026-10-12T00:00:00Z',
      '20261012',
      '2026-1-5',
      '2026-13-01',
      '2026-02-30',
      '2026-02-29',
    ]) {
      assert.deepEqual(getTaskWolfTokenExpiry(env(value)), invalid, value);
    }
    // A leap day is a day.
    assert.equal(getTaskWolfTokenExpiry(env('2028-02-29')).state, 'ok');
    assert.equal(getTaskWolfTokenExpiry(env(' 2026-10-12 ')).expiresOn, '2026-10-12');
  });

  test('reads the environment on every call, not once', (t) => {
    at(t, '2026-09-28T18:00:00.000Z');
    const names = ['TASK_WOLF_MCP_TOKEN', 'TASK_WOLF_MCP_TOKEN_EXPIRES_ON'];
    const saved = names.map((name) => [name, process.env[name]]);
    t.after(() => {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
    process.env.TASK_WOLF_MCP_TOKEN = 'twmcp_test';
    process.env.TASK_WOLF_MCP_TOKEN_EXPIRES_ON = '2026-10-12';
    assert.equal(getTaskWolfTokenExpiry().state, 'expiring');
    process.env.TASK_WOLF_MCP_TOKEN_EXPIRES_ON = '2026-12-27';
    assert.deepEqual(getTaskWolfTokenExpiry(), {
      expiresOn: '2026-12-27',
      daysLeft: 90,
      state: 'ok',
    });
    delete process.env.TASK_WOLF_MCP_TOKEN_EXPIRES_ON;
    assert.equal(getTaskWolfTokenExpiry().state, 'none');
  });
});

describe('parseSseBody', () => {
  test('reads every data frame, joins multi-line data, ignores comments and keep-alives', () => {
    const body = [
      ': keep-alive',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,',
      'data: "result":{"ok":true}}',
      '',
      'data: not json',
      '',
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
      '',
    ].join('\n');
    const messages = parseSseBody(body);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0], { jsonrpc: '2.0', id: 1, result: { ok: true } });
    assert.equal(messages[1].method, 'notifications/message');
  });
});

describe('parseToolResult', () => {
  test('prefers structuredContent, then JSON text, then plain text', () => {
    assert.deepEqual(
      parseToolResult({
        content: [{ type: 'text', text: '{"a":1}' }],
        structuredContent: { b: 2 },
      }),
      { b: 2 },
    );
    assert.deepEqual(parseToolResult({ content: [{ type: 'text', text: ' {"a":1} ' }] }), { a: 1 });
    assert.equal(
      parseToolResult({ content: [{ type: 'text', text: 'Nothing in maintenance.' }] }),
      'Nothing in maintenance.',
    );
    assert.equal(parseToolResult({ content: [] }), null);
  });

  test('a tool-level error is thrown, not returned as data', () => {
    assert.throws(
      () =>
        parseToolResult(
          { isError: true, content: [{ type: 'text', text: 'Unknown customer "x"' }] },
          'find_customer',
        ),
      (error) =>
        error instanceof TaskWolfToolError &&
        /Unknown customer/.test(error.message) &&
        error.tool === 'find_customer',
    );
  });
});

describe('createTaskWolfClient', () => {
  test('handshakes once, lists tools, calls a tool and parses its JSON text', async () => {
    const server = fakeServer({
      tools: [
        {
          name: 'get_maintenance_status',
          inputSchema: { type: 'object', properties: { customer: { type: 'string' } } },
        },
      ],
      onCall: (message, reply) =>
        reply({
          content: [
            { type: 'text', text: JSON.stringify({ total: 2, truncated: false, items: [] }) },
          ],
        }),
    });
    const client = createTaskWolfClient({
      fetchImpl: server.fetchImpl,
      token: 'twmcp_test',
      baseUrl: 'https://tw.test/mcp',
    });

    const tools = await client.listTools();
    assert.equal(tools[0].name, 'get_maintenance_status');
    // Listed once and kept: asking again sends nothing.
    assert.equal(await client.listTools(), tools);

    const answer = await client.callTool('get_maintenance_status', { customer: 'acme' });
    assert.deepEqual(answer, { total: 2, truncated: false, items: [] });
    await client.callTool('get_maintenance_status', { customer: 'globex' });

    const methods = server.requests.map((r) => r.message.method);
    assert.deepEqual(methods, [
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
      'tools/call',
    ]);
    // Every request carries the bearer token and the protocol version.
    for (const r of server.requests) {
      assert.equal(r.headers.Authorization, 'Bearer twmcp_test');
      assert.equal(r.headers['MCP-Protocol-Version'], '2025-06-18');
      assert.equal(r.url, 'https://tw.test/mcp');
    }
    assert.deepEqual(client.getServerInfo(), { name: 'task-wolf', version: '1.0.0' });
  });

  test('reads answers delivered as a server-sent-event stream', async () => {
    const server = fakeServer({
      sse: true,
      onCall: (message, reply) =>
        reply({ structuredContent: { total: 1, items: [{ flowId: 'f' }] } }),
    });
    const client = createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
    const answer = await client.callTool('find_tasks', { customer: 'acme' });
    assert.deepEqual(answer, { total: 1, items: [{ flowId: 'f' }] });
  });

  test('echoes a session id once the server hands one out', async () => {
    const server = fakeServer({
      sessionId: 'sess-1',
      onCall: (m, reply) => reply({ content: [] }),
    });
    const client = createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
    await client.callTool('find_tasks', {});
    const last = server.requests[server.requests.length - 1];
    assert.equal(last.headers['Mcp-Session-Id'], 'sess-1');
  });

  test('401 becomes a TaskWolfAuthError and the handshake is retried next time', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    };
    const client = createTaskWolfClient({ fetchImpl, token: 'twmcp_expired' });
    await assert.rejects(() => client.callTool('find_tasks', {}), TaskWolfAuthError);
    await assert.rejects(() => client.callTool('find_tasks', {}), TaskWolfAuthError);
    assert.equal(calls, 2); // one initialize attempt per call, nothing cached as "initialized"
  });

  test('403 is a TaskWolfForbiddenError about that one request, not an expired token', async () => {
    const server = fakeServer({
      onCall: (message, reply) =>
        message.params.arguments.customer === 'acme'
          ? jsonResponse({ error: 'not your customer' }, { status: 403 })
          : reply({ structuredContent: { total: 0 } }),
    });
    const client = createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
    await assert.rejects(
      () => client.callTool('find_tasks', { customer: 'acme' }),
      (error) =>
        error instanceof TaskWolfForbiddenError &&
        !(error instanceof TaskWolfAuthError) &&
        error.code === 'TW_FORBIDDEN' &&
        error.status === 403 &&
        /tools\/call returned 403/.test(error.message) &&
        /not your customer/.test(error.message),
    );
    // The next customer is answered, on the handshake already made.
    assert.deepEqual(await client.callTool('find_tasks', { customer: 'globex' }), { total: 0 });
    const methods = server.requests.map((r) => r.message.method);
    assert.equal(methods.filter((m) => m === 'initialize').length, 1);
  });

  test('a JSON-RPC error on tools/call surfaces as a TaskWolfToolError with the rpc code', async () => {
    const server = fakeServer({
      onCall: (message) =>
        jsonResponse({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: 'customer is required' },
        }),
    });
    const client = createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
    await assert.rejects(
      () => client.callTool('get_maintenance_status', {}),
      (error) =>
        error instanceof TaskWolfToolError &&
        error.rpcCode === -32602 &&
        /customer is required/.test(error.message),
    );
  });

  test('"already initialized" from a stateless server counts as a successful handshake', async () => {
    const server = fakeServer({
      onCall: (m, reply) => reply({ content: [{ type: 'text', text: '[]' }] }),
    });
    const fetchImpl = async (url, init) => {
      const message = JSON.parse(init.body);
      if (message.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32600, message: 'Server already initialized' },
        });
      }
      return server.fetchImpl(url, init);
    };
    const client = createTaskWolfClient({ fetchImpl, token: 'twmcp_test' });
    assert.deepEqual(await client.callTool('find_tasks', {}), []);
  });

  test('a missing token is a config error before any request is made', async () => {
    let called = false;
    const client = createTaskWolfClient({
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    const saved = process.env.TASK_WOLF_MCP_TOKEN;
    delete process.env.TASK_WOLF_MCP_TOKEN;
    try {
      await assert.rejects(
        () => client.listTools(),
        (error) => error.code === 'TW_CONFIG',
      );
    } finally {
      if (saved !== undefined) process.env.TASK_WOLF_MCP_TOKEN = saved;
    }
    assert.equal(called, false);
  });
});

describe('failures after the response headers arrive', () => {
  /** Handshake answered properly; the tool call answered with `response`. */
  function clientAnswering(response) {
    const server = fakeServer({ onCall: () => response });
    return createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
  }
  const unreadable = (failure, { status = 200 } = {}) => ({
    ...jsonResponse(undefined, { status }),
    text: async () => {
      throw failure;
    },
  });

  test('a 200 whose body is not JSON is TW_UPSTREAM, quoting the first 300 characters', async () => {
    const page = `<html><body>Bad gateway</body></html>${'x'.repeat(400)}`;
    const client = clientAnswering({ ...jsonResponse(undefined), text: async () => page });
    await assert.rejects(
      () => client.callTool('find_tasks', { customer: 'acme' }),
      (error) =>
        !(error instanceof SyntaxError) &&
        error.code === 'TW_UPSTREAM' &&
        error.message ===
          `Task Wolf MCP tools/call returned a body that is not JSON: ${page.slice(0, 300)}`,
    );
  });

  test('a timeout while the body is read is TW_NETWORK, not a DOMException with code 23', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    assert.equal(timeout.code, 23); // what used to reach the route as its "code"
    const client = clientAnswering(unreadable(timeout));
    await assert.rejects(
      () => client.callTool('find_tasks', { customer: 'acme' }),
      (error) =>
        error.code === 'TW_NETWORK' &&
        /tools\/call/.test(error.message) &&
        /aborted due to timeout/.test(error.message),
    );
  });

  test('a connection reset while the body is read is TW_NETWORK, whatever the status', async () => {
    for (const status of [200, 500]) {
      const client = clientAnswering(unreadable(new TypeError('terminated'), { status }));
      await assert.rejects(
        () => client.callTool('find_tasks', { customer: 'acme' }),
        (error) =>
          !(error instanceof TypeError) &&
          error.code === 'TW_NETWORK' &&
          /tools\/call/.test(error.message) &&
          /terminated/.test(error.message),
      );
    }
  });
});

describe('stale session recovery', () => {
  async function warmClient(options) {
    const server = sessionServer(options);
    const client = createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
    await client.callTool('find_tasks', { customer: 'warm-up' }); // under sess-1
    return { server, client };
  }

  test('calls in flight together share one re-initialize and are each retried', async () => {
    const { server, client } = await warmClient();
    server.forget();
    const answers = await Promise.all(
      ['acme', 'globex', 'initech'].map((customer) => client.callTool('find_tasks', { customer })),
    );
    assert.deepEqual(
      answers.map((a) => a.session),
      ['sess-2', 'sess-2', 'sess-2'],
    );
    assert.equal(server.count('initialize'), 2);
    assert.equal(server.count('tools/call'), 1 + 3 + 3); // warm-up, three 404s, three retries
  });

  test('a 404 that lands late, for the old session, leaves the new session alone', async () => {
    const { server, client } = await warmClient();
    server.forget();
    const release = server.hold('slow');
    const slow = client.callTool('find_tasks', { customer: 'slow' });
    const fast = await client.callTool('find_tasks', { customer: 'fast' });
    assert.equal(fast.session, 'sess-2'); // recovered while the other 404 was still on its way

    release();
    assert.equal((await slow).session, 'sess-2');
    assert.equal((await client.callTool('find_tasks', { customer: 'next' })).session, 'sess-2');
    assert.equal(server.count('initialize'), 2);
  });

  test('a late answer that still names the old session does not bring it back', async () => {
    const { server, client } = await warmClient();
    const release = server.hold('slow');
    const slow = client.callTool('find_tasks', { customer: 'slow' }); // answered under sess-1
    await new Promise((resolve) => setImmediate(resolve)); // let it reach the server first
    server.forget();
    await client.callTool('find_tasks', { customer: 'fast' });

    release();
    assert.equal((await slow).session, 'sess-1');
    assert.equal((await client.callTool('find_tasks', { customer: 'next' })).session, 'sess-2');
    assert.equal(server.count('initialize'), 2);
  });

  test('a call that starts while another is recovering waits for the new session', async () => {
    // However many microtasks apart the two start, the second must never go
    // out between the old session being dropped and the new one arriving.
    for (let gap = 0; gap <= 20; gap += 1) {
      const { server, client } = await warmClient();
      server.forget();
      const first = client.callTool('find_tasks', { customer: 'first' });
      for (let i = 0; i < gap; i += 1) await Promise.resolve();
      const second = client.callTool('find_tasks', { customer: 'second' });
      const answers = await Promise.all([first, second]);
      assert.deepEqual(
        answers.map((a) => a.session),
        ['sess-2', 'sess-2'],
        `gap ${gap}`,
      );
      assert.equal(server.count('initialize'), 2, `gap ${gap}`);
      assert.equal(
        server.requests.filter((r) => r.method === 'tools/call' && !r.session).length,
        0,
      );
    }
  });

  test('listTools recovers the same way', async () => {
    const { server, client } = await warmClient({ tools: [{ name: 'find_tasks' }] });
    server.forget();
    assert.deepEqual(await client.listTools(), [{ name: 'find_tasks' }]);
    assert.equal(server.count('initialize'), 2);
    assert.deepEqual(
      server.requests.filter((r) => r.method === 'tools/list').map((r) => r.session),
      ['sess-1', 'sess-2'],
    );
  });

  test('a call is retried once, however often the server says 404', async () => {
    const server = sessionServer({ alwaysStale: true });
    const client = createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
    await assert.rejects(
      () => client.callTool('find_tasks', { customer: 'acme' }),
      (error) => error.code === 'TW_UPSTREAM' && error.status === 404,
    );
    assert.equal(server.count('tools/call'), 2);
    assert.equal(server.count('initialize'), 2);
  });

  test('a 404 from a server that never issued a session is not retried', async () => {
    const server = fakeServer({
      onCall: () => jsonResponse({ error: 'no such route' }, { status: 404 }),
    });
    const client = createTaskWolfClient({ fetchImpl: server.fetchImpl, token: 'twmcp_test' });
    await assert.rejects(
      () => client.callTool('find_tasks', { customer: 'acme' }),
      (error) => error.code === 'TW_UPSTREAM' && error.status === 404,
    );
    const methods = server.requests.map((r) => r.message.method);
    assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/call']);
  });
});
