/**
 * The QA Wolf client speaks tRPC and REST over HTTP with a fake fetch, so these
 * pin what the scan leans on: the paths production actually serves, which status
 * means "the key is dead" and which means "not this workspace", how upstream
 * failures are worded, both response envelopes and where the cursor walk stops,
 * saying so when it stops before the list does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  QAW_INVALID_TOKEN_MESSAGE,
  QawAuthError,
  QawForbiddenError,
  listOpenMaintenanceReports,
  listWorkspaces,
  qawQuery,
} from '../src/projects/maintenance-dashboard/qawolfClient.js';

function textResponse(text, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

function jsonResponse(body, options) {
  return textResponse(JSON.stringify(body), options);
}

/** A fake API: records every request and answers with whatever `respond` returns. */
function fakeApi(respond) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const isTrpc = parsed.pathname.startsWith('/api/trpc/');
    const request = {
      url,
      path: parsed.pathname,
      procedure: isTrpc ? parsed.pathname.replace('/api/trpc/', '') : null,
      input: isTrpc ? JSON.parse(parsed.searchParams.get('input')).json : undefined,
      headers: init.headers,
    };
    requests.push(request);
    return respond(request);
  };
  return { requests, options: { fetchImpl, token: 'qaw_test', baseUrl: 'https://qaw.test' } };
}

describe('qawQuery', () => {
  test('sends the input superjson-wrapped with the bearer key', async () => {
    const api = fakeApi(() => jsonResponse({ result: { data: { json: { ok: true } } } }));
    await qawQuery('issue.find', { workspaceId: 'ws-1', limit: 100 }, api.options);

    assert.equal(api.requests.length, 1);
    const [request] = api.requests;
    assert.ok(request.url.startsWith('https://qaw.test/api/trpc/issue.find?input='));
    assert.deepEqual(request.input, { workspaceId: 'ws-1', limit: 100 });
    assert.equal(request.headers.Authorization, 'Bearer qaw_test');
  });

  test('unwraps the superjson envelope', async () => {
    const api = fakeApi(() =>
      jsonResponse({ result: { data: { json: { issues: [{ issueId: 'i-1' }] }, meta: {} } } }),
    );
    assert.deepEqual(await qawQuery('issue.find', {}, api.options), {
      issues: [{ issueId: 'i-1' }],
    });
  });

  test('unwraps the plain envelope', async () => {
    const api = fakeApi(() => jsonResponse({ result: { data: { issues: [{ issueId: 'i-1' }] } } }));
    assert.deepEqual(await qawQuery('issue.find', {}, api.options), {
      issues: [{ issueId: 'i-1' }],
    });
  });

  test('401 becomes a QawAuthError: the key itself is dead', async () => {
    const api = fakeApi(() => jsonResponse({ error: 'unauthorized' }, { status: 401 }));
    await assert.rejects(
      () => qawQuery('whoami', {}, api.options),
      (error) =>
        error instanceof QawAuthError &&
        error.code === 'QAW_AUTH' &&
        error.message === QAW_INVALID_TOKEN_MESSAGE,
    );
  });

  test('403 becomes a QawForbiddenError that names the procedure, not a dead key', async () => {
    const api = fakeApi(() => textResponse('Forbidden: not a member of ws-9', { status: 403 }));
    await assert.rejects(
      () => qawQuery('issue.find', { workspaceId: 'ws-9' }, api.options),
      (error) => {
        assert.ok(error instanceof QawForbiddenError);
        assert.ok(!(error instanceof QawAuthError));
        assert.equal(error.name, 'QawForbiddenError');
        assert.equal(error.code, 'QAW_FORBIDDEN');
        assert.equal(error.status, 403);
        assert.equal(
          error.message,
          'QA Wolf issue.find returned 403: Forbidden: not a member of ws-9',
        );
        return true;
      },
    );
  });

  test('a 403 message carries only the first 300 characters of the body', async () => {
    const api = fakeApi(() => textResponse('x'.repeat(301), { status: 403 }));
    await assert.rejects(
      () => qawQuery('issue.find', {}, api.options),
      (error) =>
        error.code === 'QAW_FORBIDDEN' &&
        error.message === `QA Wolf issue.find returned 403: ${'x'.repeat(300)}`,
    );
  });

  test('500 becomes QAW_UPSTREAM with the status and the start of the body', async () => {
    const api = fakeApi(() => textResponse(`boom ${'x'.repeat(400)}`, { status: 500 }));
    await assert.rejects(
      () => qawQuery('issue.find', {}, api.options),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.status === 500 &&
        error.message === `QA Wolf issue.find returned 500: boom ${'x'.repeat(295)}`,
    );
  });

  test('a 200 with a non-JSON body is QAW_UPSTREAM', async () => {
    const api = fakeApi(() => textResponse('<html>Sign in</html>'));
    await assert.rejects(
      () => qawQuery('whoami', {}, api.options),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.message === 'QA Wolf whoami returned a non-JSON body.',
    );
  });

  test('a tRPC error body is QAW_UPSTREAM with its message, superjson-wrapped or plain', async () => {
    const wrapped = fakeApi(() =>
      jsonResponse({ error: { json: { message: 'workspaceId is required', code: -32600 } } }),
    );
    await assert.rejects(
      () => qawQuery('issue.find', {}, wrapped.options),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.message === 'QA Wolf issue.find error: workspaceId is required',
    );

    const plain = fakeApi(() => jsonResponse({ error: { message: 'no such procedure' } }));
    await assert.rejects(
      () => qawQuery('issue.nope', {}, plain.options),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.message === 'QA Wolf issue.nope error: no such procedure',
    );
  });

  test('a request that never gets an answer is QAW_NETWORK', async () => {
    const fetchImpl = async () => {
      throw new Error('getaddrinfo ENOTFOUND qaw.test');
    };
    await assert.rejects(
      () => qawQuery('whoami', {}, { fetchImpl, token: 'qaw_test', baseUrl: 'https://qaw.test' }),
      (error) =>
        error.code === 'QAW_NETWORK' && /whoami request failed.*ENOTFOUND/.test(error.message),
    );
  });

  test('a body that stops arriving after the headers is QAW_NETWORK, and names the procedure', async () => {
    // What `AbortSignal.timeout` raises mid-read: a DOMException whose own
    // `code` is the number 23.
    const timedOut = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    assert.equal(timedOut.code, 23);
    const reset = Object.assign(new TypeError('terminated'), { code: 'UND_ERR_SOCKET' });

    for (const [failure, reason] of [
      [timedOut, 'The operation was aborted due to timeout'],
      [reset, 'terminated'],
      ['socket hang up', 'socket hang up'],
    ]) {
      const api = fakeApi(() => ({
        ok: true,
        status: 200,
        text: async () => {
          throw failure;
        },
      }));
      await assert.rejects(
        () => qawQuery('issue.find', { workspaceId: 'ws-1' }, api.options),
        (error) => {
          assert.equal(error.code, 'QAW_NETWORK');
          assert.equal(error.message, `QA Wolf issue.find response could not be read: ${reason}`);
          return true;
        },
      );
    }
  });

  test('a 401 is QAW_AUTH even when its body cannot be read', async () => {
    const api = fakeApi(() => ({
      ok: false,
      status: 401,
      text: async () => {
        throw new TypeError('other side closed');
      },
    }));
    await assert.rejects(
      () => qawQuery('issue.find', { workspaceId: 'ws-1' }, api.options),
      (error) => error instanceof QawAuthError && error.code === 'QAW_AUTH',
    );
  });

  test('a 403 is QAW_FORBIDDEN even when its body cannot be read', async () => {
    const api = fakeApi(() => ({
      ok: false,
      status: 403,
      text: async () => {
        throw new TypeError('other side closed');
      },
    }));
    await assert.rejects(
      () => qawQuery('issue.find', { workspaceId: 'ws-9' }, api.options),
      (error) =>
        error instanceof QawForbiddenError &&
        error.code === 'QAW_FORBIDDEN' &&
        error.message === 'QA Wolf issue.find returned 403: ',
    );
  });

  test('a missing key is a config error before any request is made', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return jsonResponse({});
    };
    const saved = { token: process.env.QAW_BEARER_TOKEN, key: process.env.QAWOLF_API_KEY };
    delete process.env.QAW_BEARER_TOKEN;
    delete process.env.QAWOLF_API_KEY;
    try {
      await assert.rejects(
        () => qawQuery('whoami', {}, { fetchImpl, baseUrl: 'https://qaw.test' }),
        (error) => error.code === 'QAW_CONFIG',
      );
    } finally {
      if (saved.token !== undefined) process.env.QAW_BEARER_TOKEN = saved.token;
      if (saved.key !== undefined) process.env.QAWOLF_API_KEY = saved.key;
    }
    assert.equal(called, false);
  });
});

describe("qawQuery against production's router", () => {
  // What app.qawolf.com answers for a public procedure called without its
  // `public.` namespace: the web app's router does not know it.
  test('a procedure the router does not know is a 404 upstream failure, not a dead key', async () => {
    const notFound = {
      error: {
        json: {
          code: -32004,
          data: { code: 'NOT_FOUND', httpStatus: 404, path: 'issue.find' },
          message: 'The app is out of date. Please refresh the page.',
        },
      },
    };
    const api = fakeApi(() => jsonResponse(notFound, { status: 404 }));
    await assert.rejects(
      () => qawQuery('issue.find', {}, api.options),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.status === 404 &&
        /^QA Wolf issue\.find returned 404: .*The app is out of date/.test(error.message),
    );
  });
});

describe('listWorkspaces', () => {
  test("reads identity/organizations over REST and flattens each organization's workspaces", async () => {
    const api = fakeApi(() =>
      jsonResponse({
        organizations: [
          {
            id: 'org-1',
            name: 'Acme Inc',
            workOsOrganizationId: 'wos-1',
            workspaces: [
              { id: 'ws-1', name: 'Acme', slug: 'acme' },
              { id: 'ws-2', name: 'Acme Staging', slug: 'acme-staging' },
            ],
          },
          { id: 'org-2', name: 'Globex', workOsOrganizationId: 'wos-2', workspaces: [] },
          {
            id: 'org-3',
            name: 'Initech',
            workOsOrganizationId: 'wos-3',
            workspaces: [{ id: 'ws-3', name: 'Initech', slug: 'initech' }],
          },
        ],
      }),
    );

    assert.deepEqual(await listWorkspaces(api.options), [
      { id: 'ws-1', name: 'Acme', slug: 'acme', organizationName: 'Acme Inc' },
      { id: 'ws-2', name: 'Acme Staging', slug: 'acme-staging', organizationName: 'Acme Inc' },
      { id: 'ws-3', name: 'Initech', slug: 'initech', organizationName: 'Initech' },
    ]);
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].url, 'https://qaw.test/api/v0/identity/organizations');
    assert.equal(api.requests[0].headers.Authorization, 'Bearer qaw_test');
  });

  test('a key that reaches no organization lists no workspaces', async () => {
    const api = fakeApi(() => jsonResponse({ organizations: [] }));
    assert.deepEqual(await listWorkspaces(api.options), []);
  });

  test('a body without an organizations list is an upstream failure naming what came back', async () => {
    const api = fakeApi(() => jsonResponse({ team: { id: 't-1', name: 'One' } }));
    await assert.rejects(
      () => listWorkspaces(api.options),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.message === 'Unexpected identity/organizations shape. Got keys: team',
    );
  });

  test('a 401 whose body is cut off is still a dead key', async () => {
    const api = fakeApi(() => ({
      ok: false,
      status: 401,
      text: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    }));
    await assert.rejects(
      () => listWorkspaces(api.options),
      (error) => error instanceof QawAuthError && error.code === 'QAW_AUTH',
    );
  });
});

describe('listOpenMaintenanceReports', () => {
  const page = (issues, nextCursor) =>
    jsonResponse({ result: { data: { json: { issues, nextCursor } } } });

  test('walks the cursor and stops when nextCursor is absent', async () => {
    const api = fakeApi(({ input }) =>
      input.cursor === undefined
        ? page([{ issueId: 'i-1' }, { issueId: 'i-2' }], 'cursor-2')
        : page([{ issueId: 'i-3' }]),
    );
    const { issues, truncated } = await listOpenMaintenanceReports('ws-1', api.options);

    assert.deepEqual(
      issues.map((issue) => issue.issueId),
      ['i-1', 'i-2', 'i-3'],
    );
    assert.equal(truncated, false);
    assert.equal(api.requests.length, 2);
    assert.equal(api.requests[0].procedure, 'public.issue.find');
    assert.deepEqual(api.requests[0].input, {
      workspaceId: 'ws-1',
      type: 'maintenance',
      statuses: ['pending', 'inProgress', 'paused'],
      limit: 100,
    });
    assert.equal(api.requests[1].input.cursor, 'cursor-2');
  });

  test('a single page without a cursor is one request', async () => {
    const api = fakeApi(() => page([{ issueId: 'i-1' }]));
    const { issues, truncated } = await listOpenMaintenanceReports('ws-1', api.options);
    assert.equal(issues.length, 1);
    assert.equal(truncated, false);
    assert.equal(api.requests.length, 1);
  });

  // Page n (from 1) is asked for with `cursor-n`, and is 100 reports long.
  const pageNumber = (input) =>
    input.cursor === undefined ? 1 : Number(input.cursor.replace('cursor-', ''));
  const fullPage = (n) => Array.from({ length: 100 }, (_, i) => ({ issueId: `i-${n}-${i}` }));

  test('50 full pages with a cursor still handed back is a list cut short', async () => {
    const api = fakeApi(({ input }) => {
      const n = pageNumber(input);
      return page(fullPage(n), `cursor-${n + 1}`);
    });
    const { issues, truncated } = await listOpenMaintenanceReports('ws-1', api.options);
    assert.equal(api.requests.length, 50);
    assert.equal(api.requests.at(-1).input.cursor, 'cursor-50');
    assert.equal(issues.length, 5000);
    assert.equal(truncated, true);
  });

  test('a 50th page with no cursor after it is the whole list, not one cut short', async () => {
    const api = fakeApi(({ input }) => {
      const n = pageNumber(input);
      return page(fullPage(n), n < 50 ? `cursor-${n + 1}` : undefined);
    });
    const { issues, truncated } = await listOpenMaintenanceReports('ws-1', api.options);
    assert.equal(api.requests.length, 50);
    assert.equal(issues.length, 5000);
    assert.equal(truncated, false);
  });

  test('an empty 50th page ends the list, whatever cursor comes with it', async () => {
    const api = fakeApi(({ input }) => {
      const n = pageNumber(input);
      return page(n < 50 ? fullPage(n) : [], `cursor-${n + 1}`);
    });
    const { issues, truncated } = await listOpenMaintenanceReports('ws-1', api.options);
    assert.equal(api.requests.length, 50);
    assert.equal(issues.length, 4900);
    assert.equal(truncated, false);
  });

  test('a 403 on one workspace is QAW_FORBIDDEN, so the scan can carry on past it', async () => {
    const api = fakeApi(() => textResponse('Forbidden', { status: 403 }));
    await assert.rejects(
      () => listOpenMaintenanceReports('ws-locked', api.options),
      (error) =>
        error instanceof QawForbiddenError &&
        error.code === 'QAW_FORBIDDEN' &&
        /^QA Wolf public\.issue\.find returned 403/.test(error.message),
    );
  });

  test('a page whose body cannot be read fails the workspace as QAW_NETWORK', async () => {
    const api = fakeApi(({ input }) =>
      input.cursor === undefined
        ? page([{ issueId: 'i-1' }], 'cursor-2')
        : {
            ok: true,
            status: 200,
            text: async () => {
              throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
            },
          },
    );
    await assert.rejects(
      () => listOpenMaintenanceReports('ws-1', api.options),
      (error) =>
        error.code === 'QAW_NETWORK' &&
        /^QA Wolf public\.issue\.find response could not be read: /.test(error.message),
    );
    assert.equal(api.requests.length, 2);
  });
});
