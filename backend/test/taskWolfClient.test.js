/**
 * The Task Wolf MCP client speaks JSON-RPC over HTTP with a fake fetch, so
 * these pin the protocol details that would otherwise only fail in production:
 * the handshake, JSON and SSE answers, auth failures, tool errors and the
 * session-id dance.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TaskWolfAuthError,
  TaskWolfToolError,
  createTaskWolfClient,
  getTaskWolfMcpUrl,
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
    assert.deepEqual(await client.toolSchema('get_maintenance_status'), {
      type: 'object',
      properties: { customer: { type: 'string' } },
    });

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
