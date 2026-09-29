/**
 * The scan orchestration: bounded fan-out, partial failure tolerated, auth
 * failure not. The client is injected so nothing here touches the network.
 */
import { test, describe, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichWithTaskWolf,
  findCachedCustomer,
  mapWithConcurrency,
  probeTaskWolfCustomer,
  scanMaintenanceBacklog,
  getCacheTtlMs,
  getMaintenanceDashboard,
  getMaintenanceStatus,
  getMinRescanMs,
  getRetryCooldownMs,
  getTaskWolfMaxConsecutiveFailures,
  getTaskWolfPassBudgetMs,
  requestRescan,
  resetMaintenanceCache,
  startRefresh,
} from '../src/projects/maintenance-dashboard/maintenanceService.js';
import { parseExcludedSlugs } from '../src/projects/maintenance-dashboard/maintenanceShape.js';
import {
  QawAuthError,
  QawForbiddenError,
} from '../src/projects/maintenance-dashboard/qawolfClient.js';
import {
  TaskWolfAuthError,
  TaskWolfForbiddenError,
  TaskWolfToolError,
  resetSharedTaskWolfClient,
} from '../src/projects/maintenance-dashboard/taskWolfMcpClient.js';

/**
 * Hermetic whatever the shell has exported or a .env holds. Left to
 * themselves the scans fall back to the default clients, which read the keys
 * and would go and ask production; without the keys they throw before any
 * request. The Bone Pile's other settings (limits, cache window, excluded
 * slugs, base URLs) would change what the tests see, so every one of them is
 * cleared too, by prefix. `fetch` is a tripwire on top of that: a request
 * that gets that far is recorded, and fails the test it happened in even when
 * the code under test swallowed the throw. Both are put back once the file's
 * tests are done.
 */
const originalEnv = { ...process.env };
// The routes load the auth middleware, and through it dotenv, which reads the
// .env of the working directory into the process. Imported only now, so the
// copy above is the environment as it was before that.
const { default: maintenanceRouter, statusForError } = await import(
  '../src/projects/maintenance-dashboard/routes/index.js'
);
const OWN_PREFIXES = ['MAINTENANCE_DASHBOARD_', 'TASK_WOLF_', 'QAW_', 'QAWOLF_'];
for (const name of Object.keys(process.env)) {
  if (OWN_PREFIXES.some((prefix) => name.startsWith(prefix))) delete process.env[name];
}

const realFetch = globalThis.fetch;
const reachedFetch = [];
globalThis.fetch = async (url) => {
  reachedFetch.push(String(url));
  throw new Error(`A test reached fetch: ${url}`);
};

afterEach(() => {
  assert.deepEqual(reachedFetch.splice(0), [], 'a test sent a request to the network');
});

after(() => {
  globalThis.fetch = realFetch;
  for (const name of Object.keys(process.env)) {
    if (!(name in originalEnv)) delete process.env[name];
  }
  Object.assign(process.env, originalEnv);
});

const NOW = Date.parse('2026-09-28T18:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const workspaces = [
  { id: 'ws-1', name: 'One', slug: 'one', organizationName: 'One' },
  { id: 'ws-2', name: 'Two', slug: 'two', organizationName: 'Two' },
  { id: 'ws-3', name: 'Three', slug: 'three', organizationName: 'Three' },
  { id: 'ws-figma', name: 'Figma', slug: 'figma', organizationName: 'Figma' },
];

/** `count` plain workspaces, for the tests that need more than four. */
const manyWorkspaces = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: `w-${i}`, name: `W${i}`, slug: `w${i}` }));

const upstream500 = (workspaceId) =>
  Object.assign(new Error(`QA Wolf issue.find returned 500: ${workspaceId}`), {
    code: 'QAW_UPSTREAM',
    status: 500,
  });

/**
 * A fake QA Wolf client. `failing` workspaces throw a plain error; `failWith`
 * decides per workspace and hands back the error to throw, or nothing.
 */
function fakeClient({
  listed = workspaces,
  failing = new Set(),
  failWith = () => null,
  authFail = false,
} = {}) {
  const calls = [];
  return {
    calls,
    listWorkspaces: async () => listed,
    listOpenMaintenanceReports: async (workspaceId) => {
      calls.push(workspaceId);
      if (authFail) throw new QawAuthError();
      if (failing.has(workspaceId)) throw new Error(`${workspaceId} exploded`);
      const failure = failWith(workspaceId);
      if (failure) throw failure;
      if (workspaceId === 'ws-2') {
        return [
          {
            issueId: 'i-2',
            number: 7,
            name: 'Broken checkout',
            status: 'pending',
            createdAt: daysAgo(45),
            reproductions: [{ flowId: 'f1' }, { flowId: 'f2' }],
          },
        ];
      }
      if (workspaceId === 'ws-figma') {
        return [{ issueId: 'i-f', number: 1, status: 'pending', createdAt: daysAgo(500) }];
      }
      return [];
    },
  };
}

describe('mapWithConcurrency', () => {
  test('never runs more than `limit` workers at once and keeps input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return item * 2;
    });
    assert.equal(peak, 3);
    assert.deepEqual(
      results.map((r) => r.value),
      items.map((i) => i * 2),
    );
  });

  test('captures a worker failure instead of aborting the batch', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('nope');
      return item;
    });
    assert.equal(results[0].value, 1);
    assert.match(results[1].error.message, /nope/);
    assert.equal(results[2].value, 3);
  });

  test('a throwing onSettled aborts the rest and surfaces the throw', async () => {
    const seen = [];
    await assert.rejects(
      mapWithConcurrency(
        [1, 2, 3, 4, 5, 6],
        1,
        async (item) => {
          seen.push(item);
          return item;
        },
        (result) => {
          if (result.value === 2) throw new Error('stop');
        },
      ),
      /stop/,
    );
    assert.deepEqual(seen, [1, 2]);
  });
});

describe('scanMaintenanceBacklog', () => {
  test('scans every workspace but the excluded one, reports progress', async () => {
    const client = fakeClient();
    const progress = [];
    const snapshot = await scanMaintenanceBacklog({
      client,
      concurrency: 2,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    // Figma is excluded by default, so it is never asked for its reports.
    assert.deepEqual([...client.calls].sort(), ['ws-1', 'ws-2', 'ws-3']);
    assert.equal(snapshot.totals.workspacesListed, 4);
    assert.equal(snapshot.totals.workspacesScanned, 3);
    assert.equal(snapshot.totals.workspacesExcluded, 1);
    assert.equal(snapshot.customers.length, 1);
    assert.equal(snapshot.customers[0].name, 'Two');
    assert.equal(snapshot.customers[0].flowsInMaintenance, 2);
    assert.equal(snapshot.reports[0].ageDays, 45);
    assert.equal(progress[0].total, 3);
    assert.equal(progress.at(-1).scanned, 3);
    assert.equal(progress.at(-1).total, 3);
  });

  test('an excluded workspace that would have failed is not counted as missing backlog', async () => {
    const client = fakeClient({ failing: new Set(['ws-figma']) });
    const snapshot = await scanMaintenanceBacklog({ client, concurrency: 2, now: () => NOW });
    assert.equal(client.calls.includes('ws-figma'), false);
    assert.equal(snapshot.totals.workspacesFailed, 0);
    assert.deepEqual(snapshot.errors, []);
  });

  test('with "none" excluded, every workspace listed is scanned', async () => {
    const client = fakeClient();
    const progress = [];
    const snapshot = await scanMaintenanceBacklog({
      client,
      concurrency: 2,
      excludedSlugs: parseExcludedSlugs('none'),
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    assert.deepEqual([...client.calls].sort(), ['ws-1', 'ws-2', 'ws-3', 'ws-figma']);
    assert.equal(snapshot.totals.workspacesScanned, 4);
    assert.equal(snapshot.totals.workspacesExcluded, 0);
    assert.equal(progress.at(-1).total, 4);
    assert.deepEqual(snapshot.customers.map((c) => c.name).sort(), ['Figma', 'Two']);
  });

  test('a workspace with no slug is scanned and shown even when its name is an excluded slug', async () => {
    // Exclusion is by slug only, and the scan and the snapshot agree on it.
    const client = fakeClient({
      listed: workspaces.map((w) => (w.id === 'ws-figma' ? { id: 'ws-figma', name: 'Figma' } : w)),
    });
    const snapshot = await scanMaintenanceBacklog({ client, concurrency: 2, now: () => NOW });
    assert.deepEqual([...client.calls].sort(), ['ws-1', 'ws-2', 'ws-3', 'ws-figma']);
    assert.equal(snapshot.totals.workspacesScanned, 4);
    assert.equal(snapshot.totals.workspacesExcluded, 0);
    assert.deepEqual(snapshot.customers.map((c) => c.name).sort(), ['Figma', 'Two']);
  });

  test('a workspace listed twice is asked once, and one without an id not at all', async () => {
    const listed = [workspaces[0], workspaces[1], { ...workspaces[1] }, { name: 'No id' }];
    const client = fakeClient({ listed });
    const progress = [];
    const snapshot = await scanMaintenanceBacklog({
      client,
      concurrency: 1,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    assert.deepEqual(client.calls, ['ws-1', 'ws-2']);
    assert.equal(progress.at(-1).total, 2);
    assert.equal(snapshot.totals.workspacesScanned, 2);
    assert.equal(snapshot.totals.openReports, 1);
  });

  test('a workspace that errors is listed, not silently dropped', async () => {
    const client = fakeClient({ failing: new Set(['ws-3']) });
    const snapshot = await scanMaintenanceBacklog({ client, concurrency: 4, now: () => NOW });
    assert.equal(snapshot.totals.workspacesFailed, 1);
    assert.equal(snapshot.errors[0].workspaceId, 'ws-3');
    assert.match(snapshot.errors[0].message, /exploded/);
    assert.equal(snapshot.customers.length, 1);
  });

  test('a 403 on one workspace is tallied and the scan carries on', async () => {
    const client = fakeClient({
      failWith: (id) =>
        id === 'ws-3' ? new QawForbiddenError('QA Wolf issue.find returned 403: no') : null,
    });
    const snapshot = await scanMaintenanceBacklog({ client, concurrency: 1, now: () => NOW });
    assert.deepEqual(client.calls, ['ws-1', 'ws-2', 'ws-3']);
    assert.equal(snapshot.totals.workspacesFailed, 1);
    assert.match(snapshot.errors[0].message, /returned 403/);
    assert.equal(snapshot.customers.length, 1);
  });

  test('an auth failure fails the whole scan', async () => {
    const client = fakeClient({ authFail: true });
    await assert.rejects(
      scanMaintenanceBacklog({ client, concurrency: 2, now: () => NOW }),
      (error) => error.code === 'QAW_AUTH',
    );
  });

  test('one 401 among answers stops the scan on sight', async () => {
    const client = fakeClient({
      listed: manyWorkspaces(30),
      failWith: (id) => (id === 'w-2' ? new QawAuthError() : null),
    });
    await assert.rejects(
      scanMaintenanceBacklog({ client, taskWolfClient: null, concurrency: 1, now: () => NOW }),
      (error) => error.code === 'QAW_AUTH',
    );
    assert.deepEqual(client.calls, ['w-0', 'w-1', 'w-2']);
  });
});

describe('scanMaintenanceBacklog: nothing but failures', () => {
  test('every workspace failing fails the scan, under the code the failures share', async () => {
    const client = fakeClient({ failWith: upstream500 });
    await assert.rejects(
      scanMaintenanceBacklog({ client, taskWolfClient: null, concurrency: 1, now: () => NOW }),
      (error) => {
        assert.equal(error.code, 'QAW_UPSTREAM');
        assert.equal(
          error.message,
          'All 3 workspaces scanned failed. First failure (One): QA Wolf issue.find returned 500: ws-1',
        );
        return true;
      },
    );
    assert.equal(client.calls.length, 3);
  });

  test('a shared 403 is QAW_FORBIDDEN; codes that differ, or none at all, are QAW_UPSTREAM', async () => {
    const scanFailsWith = (failWith) =>
      scanMaintenanceBacklog({
        client: fakeClient({ failWith }),
        taskWolfClient: null,
        concurrency: 1,
        now: () => NOW,
      }).then(
        () => 'resolved',
        (error) => error.code,
      );

    assert.equal(
      await scanFailsWith((id) => new QawForbiddenError(`403 for ${id}`)),
      'QAW_FORBIDDEN',
    );
    assert.equal(
      await scanFailsWith((id) =>
        id === 'ws-2' ? new QawForbiddenError('403 for ws-2') : upstream500(id),
      ),
      'QAW_UPSTREAM',
    );
    // The first failure's code does not stand for the rest.
    assert.equal(
      await scanFailsWith((id) =>
        id === 'ws-1' ? new QawForbiddenError('403 for ws-1') : upstream500(id),
      ),
      'QAW_UPSTREAM',
    );
    assert.equal(
      await scanFailsWith((id) =>
        id === 'ws-1' ? new QawForbiddenError('403 for ws-1') : new Error(`${id} exploded`),
      ),
      'QAW_UPSTREAM',
    );
    assert.equal(await scanFailsWith((id) => new Error(`${id} exploded`)), 'QAW_UPSTREAM');
  });

  test('one workspace scanned and failed is worded for one', async () => {
    const client = fakeClient({ listed: [workspaces[0]], failWith: upstream500 });
    await assert.rejects(
      scanMaintenanceBacklog({ client, taskWolfClient: null, now: () => NOW }),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.message ===
          'The one workspace scanned failed. First failure (One): QA Wolf issue.find returned 500: ws-1',
    );
  });

  test('exactly 20 workspaces, all failing, is all of them and not a scan stopped early', async () => {
    const client = fakeClient({ listed: manyWorkspaces(20), failWith: upstream500 });
    await assert.rejects(
      scanMaintenanceBacklog({ client, taskWolfClient: null, concurrency: 4, now: () => NOW }),
      (error) => {
        assert.equal(error.code, 'QAW_UPSTREAM');
        assert.equal(
          error.message,
          'All 20 workspaces scanned failed. First failure (W0): QA Wolf issue.find returned 500: w-0',
        );
        return true;
      },
    );
    assert.equal(client.calls.length, 20);
  });

  test('stops once the first 20 workspaces to settle have all failed', async () => {
    const client = fakeClient({
      listed: manyWorkspaces(60),
      failWith: (id) => new QawForbiddenError(`QA Wolf issue.find returned 403: ${id}`),
    });
    const progress = [];
    await assert.rejects(
      scanMaintenanceBacklog({
        client,
        taskWolfClient: null,
        concurrency: 4,
        onProgress: (p) => progress.push(p),
        now: () => NOW,
      }),
      (error) => {
        assert.equal(error.code, 'QAW_FORBIDDEN');
        assert.match(error.message, /^The first 20 of 60 workspaces scanned all failed/);
        assert.match(error.message, /First failure \(W0\): QA Wolf issue\.find returned 403: w-0/);
        return true;
      },
    );
    // The 20 that settled, plus at most the three that were in flight with the last.
    assert.ok(client.calls.length >= 20 && client.calls.length <= 23, `${client.calls.length}`);
    assert.equal(progress.at(-1).scanned, 20);
  });

  test('a 401 still in flight when the first 20 have failed makes the scan QAW_AUTH', async () => {
    // w-0..w-19 are refused at once; everything asked after them is held
    // until the scan has stopped, and w-21 then turns out to be a dead key.
    const { gate, open } = makeGate();
    const calls = [];
    const client = {
      listWorkspaces: async () => manyWorkspaces(60),
      listOpenMaintenanceReports: async (workspaceId) => {
        calls.push(workspaceId);
        if (Number(workspaceId.slice(2)) >= 20) await gate;
        if (workspaceId === 'w-21') throw new QawAuthError();
        throw new QawForbiddenError(`QA Wolf issue.find returned 403: ${workspaceId}`);
      },
    };
    const progress = [];
    const scan = scanMaintenanceBacklog({
      client,
      taskWolfClient: null,
      concurrency: 4,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    await until(() => progress.at(-1)?.scanned === 20);
    assert.ok(calls.includes('w-21'), 'w-21 was in flight when the scan stopped');
    open();
    await assert.rejects(scan, (error) => error.code === 'QAW_AUTH');
    assert.ok(calls.length <= 23, `${calls.length}`);
  });

  test('one answer among the first 20 keeps the scan going to the end', async () => {
    const listed = manyWorkspaces(30);
    const client = fakeClient({
      listed,
      failWith: (id) => (id === 'w-19' ? null : upstream500(id)),
    });
    const snapshot = await scanMaintenanceBacklog({
      client,
      taskWolfClient: null,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(client.calls.length, 30);
    assert.equal(snapshot.totals.workspacesFailed, 29);
    assert.equal(snapshot.totals.workspacesScanned, 30);
  });

  test('a key that sees no workspace to scan is an empty backlog, not a failure', async () => {
    const client = fakeClient({ listed: [workspaces[3]] });
    const snapshot = await scanMaintenanceBacklog({ client, taskWolfClient: null, now: () => NOW });
    assert.deepEqual(client.calls, []);
    assert.equal(snapshot.totals.workspacesScanned, 0);
    assert.equal(snapshot.totals.workspacesFailed, 0);

    const none = await scanMaintenanceBacklog({
      client: fakeClient({ listed: [] }),
      taskWolfClient: null,
      now: () => NOW,
    });
    assert.equal(none.totals.workspacesListed, 0);
  });

  test('whoami listing workspaces none of which has an id fails the scan, not an empty backlog', async () => {
    // A renamed id field, and entries wrapped one level down.
    const client = fakeClient({
      listed: [{ workspaceId: 'ws-1', name: 'One' }, { workspace: { id: 'ws-2' } }, null],
    });
    await assert.rejects(
      scanMaintenanceBacklog({ client, taskWolfClient: null, now: () => NOW }),
      (error) => {
        assert.equal(error.code, 'QAW_UPSTREAM');
        assert.equal(
          error.message,
          'QA Wolf listed 3 workspaces and none had an id, so there was nothing to scan. Keys of the first: workspaceId, name',
        );
        return true;
      },
    );
    assert.deepEqual(client.calls, []);

    await assert.rejects(
      scanMaintenanceBacklog({
        client: fakeClient({ listed: [{ name: 'Solo' }] }),
        taskWolfClient: null,
        now: () => NOW,
      }),
      (error) =>
        error.code === 'QAW_UPSTREAM' &&
        error.message ===
          'QA Wolf listed 1 workspace and it had no id, so there was nothing to scan. Keys of the first: name',
    );
  });
});

/**
 * A fake Task Wolf MCP: offers the two tools with a `customer` argument and
 * answers per customer slug. `failing` slugs throw; `failWith` decides per
 * call and hands back the error to throw, or nothing; `answerWith` does the
 * same for the answer, in place of the canned one; `authFailAfter` turns the
 * token stale after that many calls. `onCall` runs as each call arrives, and a
 * call waits for `gate` before it is answered; a function `gate` is asked per
 * call and may hand back a promise to hold just that customer.
 */
function fakeTaskWolf({
  failing = new Set(),
  failWith = () => null,
  answerWith = () => undefined,
  authFailAfter = Infinity,
  tools,
  onCall = () => {},
  gate = null,
} = {}) {
  const calls = [];
  const catalog = tools || [
    {
      name: 'get_maintenance_status',
      inputSchema: { type: 'object', properties: { customer: { type: 'string' } } },
    },
    {
      name: 'find_tasks',
      inputSchema: {
        type: 'object',
        properties: {
          customer: { type: 'string' },
          type: { type: 'string', enum: ['maintenance', 'creation'] },
        },
      },
    },
  ];
  return {
    calls,
    baseUrl: 'https://tw.test/mcp',
    getServerInfo: () => ({ name: 'fake-task-wolf' }),
    listTools: async () => catalog,
    callTool: async (name, args) => {
      calls.push({ name, args });
      onCall(name, args);
      if (gate) await (typeof gate === 'function' ? gate(args.customer, name) : gate);
      if (calls.length > authFailAfter) throw new TaskWolfAuthError();
      if (failing.has(args.customer)) throw new Error(`${name} timed out for ${args.customer}`);
      const failure = failWith(args.customer, name);
      if (failure) throw failure;
      const answer = answerWith(args.customer, name);
      if (answer !== undefined) return answer;
      if (name === 'get_maintenance_status') {
        if (args.customer === 'two') {
          return {
            total: 2,
            truncated: false,
            items: [
              { flowId: 'f1', name: 'Checkout', blocked: true, blocker: { title: 'Staging down' } },
              { flowId: 'f2', name: 'Search', blocked: false, assignee: 'Marta' },
            ],
          };
        }
        return { total: 0, truncated: false, items: [] };
      }
      if (name === 'find_tasks') {
        if (args.customer === 'two') {
          return {
            total: 1,
            items: [{ id: 't1', type: 'maintenance', status: 'open', assignee: 'Kalley' }],
          };
        }
        return 'No open tasks.';
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
}

/** A platform snapshot with one customer row per slug, for the pass on its own. */
const platformSnapshot = (slugs) => ({
  customers: slugs.map((slug) => ({ workspaceId: `ws-${slug}`, name: slug, slug, isDemo: false })),
  reports: [],
  totals: {},
});

const slugs = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

const taskWolfDown = (code, message) => Object.assign(new Error(message), { code });

describe('scanMaintenanceBacklog + Task Wolf', () => {
  test('without a Task Wolf client the snapshot says so and the platform data stands', async () => {
    const snapshot = await scanMaintenanceBacklog({
      client: fakeClient(),
      taskWolfClient: null,
      now: () => NOW,
    });
    assert.equal(snapshot.taskWolf.enabled, false);
    assert.equal(snapshot.taskWolf.error.code, 'TW_CONFIG');
    assert.equal(snapshot.customers[0].taskWolf, null);
    assert.equal(snapshot.reports[0].taskWolf, null);
    assert.equal(snapshot.totals.openReports, 1);
  });

  test('asks Task Wolf about each customer with backlog and folds the answer into rows and totals', async () => {
    const taskWolf = fakeTaskWolf();
    const progress = [];
    const snapshot = await scanMaintenanceBacklog({
      client: fakeClient(),
      taskWolfClient: taskWolf,
      taskWolfConcurrency: 2,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    // One customer has backlog (Figma is excluded), so two tool calls.
    assert.deepEqual(
      taskWolf.calls.map((c) => [c.name, c.args]),
      [
        ['get_maintenance_status', { customer: 'two' }],
        ['find_tasks', { customer: 'two', type: 'maintenance' }],
      ],
    );
    const two = snapshot.customers[0];
    assert.equal(two.taskWolf.blockedFlows, 1);
    assert.equal(two.taskWolf.actionableFlows, 1);
    assert.deepEqual(two.taskWolf.assignees, ['Kalley']);
    // The report parks f1 (blocked) and f2 (not): partly blocked, so actionable.
    assert.equal(snapshot.reports[0].taskWolf.blocked, false);
    assert.equal(snapshot.reports[0].taskWolf.blockedFlows, 1);
    assert.equal(snapshot.totals.blockedFlows, 1);
    assert.equal(snapshot.totals.customersWithTaskWolf, 1);
    assert.equal(snapshot.taskWolf.enabled, true);
    assert.equal(snapshot.taskWolf.error, null);
    assert.deepEqual(snapshot.taskWolf.tools, { maintenance: true, tasks: true });
    assert.equal(
      progress.some((p) => p.phase === 'taskwolf' && p.total === 1),
      true,
    );
    assert.equal(progress.at(-1).phase, 'taskwolf');
    assert.equal(progress.at(-1).scanned, 1);
  });

  test('a customer Task Wolf cannot answer is listed, and prose answers are not counted as zero', async () => {
    const snapshot = await enrichWithTaskWolf(
      {
        customers: [
          { workspaceId: 'ws-2', name: 'Two', slug: 'two', isDemo: false },
          { workspaceId: 'ws-3', name: 'Three', slug: 'three', isDemo: false },
          { workspaceId: 'ws-d', name: 'Demo', slug: 'demo', isDemo: true },
        ],
        reports: [],
        totals: {},
      },
      { client: fakeTaskWolf({ failing: new Set(['three']) }), concurrency: 1, now: () => NOW },
    );
    assert.equal(snapshot.taskWolf.customersQueried, 2); // the demo is skipped
    assert.equal(snapshot.taskWolf.customersAnswered, 1);
    assert.equal(snapshot.taskWolf.errors.length, 2);
    assert.match(snapshot.taskWolf.errors[0].message, /timed out/);
    assert.equal(snapshot.taskWolf.errors[0].workspaceName, 'Three');
    assert.equal(snapshot.customers[1].taskWolf, null);
  });

  test('an answer with nothing to read in it, JSON or prose, is listed and gives no verdict', async () => {
    const taskWolf = fakeTaskWolf({
      answerWith: (customer, name) =>
        customer === 'three' && name === 'get_maintenance_status'
          ? { message: 'No customer matched' }
          : undefined,
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two', 'three']), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(snapshot.taskWolf.error, null);
    assert.equal(snapshot.taskWolf.customersAnswered, 1);
    assert.equal(snapshot.customers[1].taskWolf, null);
    // The JSON about nothing, then the fake's prose for a customer without tasks.
    assert.deepEqual(
      snapshot.taskWolf.errors.map((e) => [e.workspaceName, e.tool, e.message]),
      [
        [
          'three',
          'get_maintenance_status',
          'get_maintenance_status gave an answer with no readable maintenance data, so it was not counted.',
        ],
        [
          'three',
          'find_tasks',
          'find_tasks gave an answer with no readable maintenance data, so it was not counted.',
        ],
      ],
    );
  });

  test('an expired token stops the Task Wolf pass, keeps what it had, and does not fail the snapshot', async () => {
    const taskWolf = fakeTaskWolf({ authFailAfter: 2 });
    const snapshot = await enrichWithTaskWolf(
      {
        customers: [
          { workspaceId: 'ws-2', name: 'Two', slug: 'two', isDemo: false },
          { workspaceId: 'ws-3', name: 'Three', slug: 'three', isDemo: false },
          { workspaceId: 'ws-4', name: 'Four', slug: 'four', isDemo: false },
        ],
        reports: [],
        totals: {},
      },
      { client: taskWolf, concurrency: 1, now: () => NOW },
    );
    assert.equal(snapshot.taskWolf.error.code, 'TW_AUTH');
    assert.equal(snapshot.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(snapshot.customers[2].taskWolf, null);
    assert.ok(taskWolf.calls.length < 6);
  });

  test('a server without the two tools is reported rather than queried', async () => {
    const snapshot = await enrichWithTaskWolf(
      { customers: [{ workspaceId: 'ws-2', name: 'Two', slug: 'two' }], reports: [], totals: {} },
      {
        client: fakeTaskWolf({ tools: [{ name: 'find_customer', inputSchema: {} }] }),
        now: () => NOW,
      },
    );
    assert.equal(snapshot.taskWolf.error.code, 'TW_TOOLS');
    assert.equal(snapshot.taskWolf.customersAnswered, 0);
  });

  test('a tools/list with junk in it is read around, not thrown over', async () => {
    const findTasks = {
      name: 'find_tasks',
      inputSchema: { type: 'object', properties: { customer: { type: 'string' } } },
    };
    const junk = fakeTaskWolf({ tools: [null, 'get_maintenance_status', 7, findTasks] });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two']), {
      client: junk,
      now: () => NOW,
    });
    assert.equal(snapshot.taskWolf.error, null);
    assert.deepEqual(snapshot.taskWolf.tools, { maintenance: false, tasks: true });
    assert.deepEqual(
      junk.calls.map((c) => c.name),
      ['find_tasks'],
    );
    assert.equal(snapshot.customers[0].taskWolf.openTasks, 1);

    // Not a list at all: nothing offered, said so, and still no throw.
    for (const catalog of [null, { tools: [] }, 'find_tasks']) {
      const odd = await enrichWithTaskWolf(platformSnapshot(['two']), {
        client: { listTools: async () => catalog, callTool: async () => null },
        now: () => NOW,
      });
      assert.equal(odd.taskWolf.error.code, 'TW_TOOLS');
      assert.equal(odd.taskWolf.customersAnswered, 0);
    }

    // The probe reads the catalog the same way.
    const probed = await probeTaskWolfCustomer(
      { id: 'ws-2', slug: 'two', name: 'Two' },
      { client: junk, now: () => NOW },
    );
    assert.equal(probed.tools.maintenance.offered, false);
    assert.equal(probed.tools.tasks.normalized.tasks.length, 1);
  });

  test('a schema with no recognisable customer argument is reported with its property names', async () => {
    const tools = [
      {
        name: 'get_maintenance_status',
        inputSchema: { type: 'object', properties: { suiteId: {} } },
      },
    ];
    const snapshot = await enrichWithTaskWolf(
      { customers: [{ workspaceId: 'ws-2', name: 'Two', slug: 'two' }], reports: [], totals: {} },
      { client: fakeTaskWolf({ tools }), now: () => NOW },
    );
    assert.equal(snapshot.taskWolf.errors.length, 1);
    assert.match(snapshot.taskWolf.errors[0].message, /suiteId/);
  });

  test('the probe returns schema, arguments, raw and normalized side by side', async () => {
    const result = await probeTaskWolfCustomer(
      { id: 'ws-2', slug: 'two', name: 'Two' },
      { client: fakeTaskWolf(), now: () => NOW },
    );
    assert.equal(result.tools.maintenance.offered, true);
    assert.deepEqual(result.tools.maintenance.arguments, { customer: 'two' });
    assert.equal(result.tools.maintenance.raw.total, 2);
    assert.equal(result.tools.maintenance.normalized.blockedFlows, 1);
    assert.equal(result.tools.tasks.normalized.tasks.length, 1);
    assert.equal(result.summary.blockedFlows, 1);
    assert.deepEqual(result.summary.assignees, ['Kalley']);
  });
});

describe('enrichWithTaskWolf: a Task Wolf that refuses or stops answering', () => {
  const outage = [
    () => new TaskWolfForbiddenError(),
    () => taskWolfDown('TW_UPSTREAM', 'Task Wolf MCP tools/call returned 500: oops'),
    () => taskWolfDown('TW_NETWORK', 'Task Wolf MCP tools/call request failed: timed out'),
  ];

  test('a 403 for one customer is that customer’s error, and the pass goes on', async () => {
    const taskWolf = fakeTaskWolf({
      failWith: (customer) =>
        customer === 'three'
          ? new TaskWolfForbiddenError('Task Wolf MCP tools/call returned 403: not yours')
          : null,
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two', 'three', 'four']), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(snapshot.taskWolf.error, null);
    assert.equal(taskWolf.calls.length, 6);
    assert.equal(snapshot.taskWolf.customersAnswered, 2);
    assert.equal(snapshot.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(snapshot.customers[1].taskWolf, null);
    assert.notEqual(snapshot.customers[2].taskWolf, null);
    assert.deepEqual(
      snapshot.taskWolf.errors.filter((e) => e.workspaceName === 'three').map((e) => e.message),
      [
        'Task Wolf MCP tools/call returned 403: not yours',
        'Task Wolf MCP tools/call returned 403: not yours',
      ],
    );
  });

  test('stops after 8 customers in a row got nothing but 403s, 500s or timeouts', async () => {
    let failed = 0;
    const taskWolf = fakeTaskWolf({
      failWith: (customer, name) => {
        if (customer === 'two') return null;
        if (name === 'get_maintenance_status') failed += 1;
        return outage[failed % outage.length]();
      },
    });
    const progress = [];
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two', ...slugs('down', 12)]), {
      client: taskWolf,
      concurrency: 1,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    // Two calls for the customer that answered, two for each of the eight.
    assert.equal(taskWolf.calls.length, 18);
    assert.equal(snapshot.taskWolf.error.code, 'TW_ABORTED');
    assert.match(
      snapshot.taskWolf.error.message,
      /^Task Wolf failed to answer for 8 customers in a row, so the pass stopped with 4 of 13 customers left\. Last failure: Task Wolf /,
    );
    // What was gathered is kept.
    assert.equal(snapshot.taskWolf.customersAnswered, 1);
    assert.equal(snapshot.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(snapshot.taskWolf.errors.length, 16);
    assert.equal(progress.at(-1).scanned, 9);
  });

  test('a customer that answers starts the count over', async () => {
    const answering = new Set(['down-7', 'down-15']);
    const taskWolf = fakeTaskWolf({
      failWith: (customer) =>
        answering.has(customer) ? null : taskWolfDown('TW_NETWORK', 'timed out'),
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(slugs('down', 16)), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(snapshot.taskWolf.error, null);
    assert.equal(taskWolf.calls.length, 32);
    assert.equal(snapshot.taskWolf.customersAnswered, 2);
  });

  test('half an answer, or a failure that is about the customer, is not an outage', async () => {
    const halves = fakeTaskWolf({
      failWith: (customer, name) =>
        name === 'find_tasks' ? taskWolfDown('TW_NETWORK', 'timed out') : null,
    });
    const half = await enrichWithTaskWolf(platformSnapshot(slugs('half', 12)), {
      client: halves,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(half.taskWolf.error, null);
    assert.equal(half.taskWolf.customersAnswered, 12);

    const strangers = fakeTaskWolf({
      failWith: (customer) =>
        customer === 'two' ? null : taskWolfDown('TW_TOOL', `Task Wolf: no customer ${customer}`),
    });
    const unknown = await enrichWithTaskWolf(platformSnapshot(['two', ...slugs('who', 12)]), {
      client: strangers,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(unknown.taskWolf.error, null);
    assert.equal(strangers.calls.length, 26);
    assert.equal(unknown.taskWolf.errors.length, 24);
  });

  test('customers no call went out for do not count toward the cut-off', async () => {
    // Neither schema names anything to pick the customer by, so nobody is
    // asked anything: no timeout was paid, and nothing says Task Wolf is down.
    const tools = ['get_maintenance_status', 'find_tasks'].map((name) => ({
      name,
      inputSchema: { type: 'object', properties: { suiteId: {} } },
    }));
    const taskWolf = fakeTaskWolf({ tools });
    const progress = [];
    const snapshot = await enrichWithTaskWolf(platformSnapshot(slugs('who', 12)), {
      client: taskWolf,
      concurrency: 1,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    assert.equal(taskWolf.calls.length, 0);
    assert.equal(progress.at(-1).scanned, 12);
    assert.equal(snapshot.taskWolf.errors.length, 24);
    assert.equal(snapshot.taskWolf.error.code, 'TW_ABORTED');
    assert.match(
      snapshot.taskWolf.error.message,
      /^Task Wolf answered for none of the 12 customers asked\. First failure \(who-0\): No customer argument recognised in the get_maintenance_status schema \(suiteId\)\.$/,
    );
  });

  test('a run that ends with the last customer cut nothing short', async () => {
    const taskWolf = fakeTaskWolf({
      failWith: (customer) => (customer === 'two' ? null : taskWolfDown('TW_NETWORK', 'timed out')),
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two', ...slugs('down', 8)]), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(snapshot.taskWolf.error, null);
    assert.equal(taskWolf.calls.length, 18);
    assert.equal(snapshot.taskWolf.customersAnswered, 1);
    assert.equal(snapshot.taskWolf.errors.length, 16);
  });

  test('stops once the pass has run past its budget, and keeps what it has', async () => {
    // Every tool call takes three minutes: six per customer.
    let clock = NOW;
    const taskWolf = fakeTaskWolf({
      onCall: () => {
        clock += 3 * 60 * 1000;
      },
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two', ...slugs('slow', 9)]), {
      client: taskWolf,
      concurrency: 1,
      budgetMs: 15 * 60 * 1000,
      now: () => clock,
    });
    // 6 and 12 minutes are inside the budget; the third customer ends at 18.
    assert.equal(taskWolf.calls.length, 6);
    assert.equal(snapshot.taskWolf.error.code, 'TW_ABORTED');
    assert.equal(
      snapshot.taskWolf.error.message,
      'The Task Wolf pass ran past its 15-minute budget, so it stopped with 7 of 10 customers left.',
    );
    assert.equal(snapshot.taskWolf.customersAnswered, 3);
    assert.equal(snapshot.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(snapshot.taskWolf.startedAt, new Date(NOW).toISOString());
    assert.equal(snapshot.taskWolf.finishedAt, new Date(NOW + 18 * 60 * 1000).toISOString());
  });

  test('a pass that ends on its own is not cut off, however long it took', async () => {
    let clock = NOW;
    const taskWolf = fakeTaskWolf({
      onCall: () => {
        clock += 10 * 60 * 1000;
      },
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two']), {
      client: taskWolf,
      concurrency: 1,
      budgetMs: 15 * 60 * 1000,
      now: () => clock,
    });
    assert.equal(snapshot.taskWolf.error, null);
    assert.equal(snapshot.taskWolf.customersAnswered, 1);
  });

  test('the limits come from the environment, 8 in a row and 15 minutes by default', async (t) => {
    const names = ['TASK_WOLF_MAX_CONSECUTIVE_FAILURES', 'TASK_WOLF_PASS_BUDGET_MINUTES'];
    const saved = names.map((name) => [name, process.env[name]]);
    t.after(() => {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    for (const name of names) delete process.env[name];
    assert.equal(getTaskWolfMaxConsecutiveFailures(), 8);
    assert.equal(getTaskWolfPassBudgetMs(), 15 * 60 * 1000);

    process.env.TASK_WOLF_MAX_CONSECUTIVE_FAILURES = '3';
    process.env.TASK_WOLF_PASS_BUDGET_MINUTES = '2';
    assert.equal(getTaskWolfMaxConsecutiveFailures(), 3);
    assert.equal(getTaskWolfPassBudgetMs(), 2 * 60 * 1000);

    const taskWolf = fakeTaskWolf({ failWith: () => taskWolfDown('TW_NETWORK', 'timed out') });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(slugs('down', 10)), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(taskWolf.calls.length, 6);
    assert.equal(snapshot.taskWolf.error.code, 'TW_ABORTED');
    assert.match(snapshot.taskWolf.error.message, /3 customers in a row/);

    // Nonsense falls back to the default rather than switching the limit off.
    process.env.TASK_WOLF_MAX_CONSECUTIVE_FAILURES = '0';
    process.env.TASK_WOLF_PASS_BUDGET_MINUTES = 'soon';
    assert.equal(getTaskWolfMaxConsecutiveFailures(), 8);
    assert.equal(getTaskWolfPassBudgetMs(), 15 * 60 * 1000);
  });

  test('at concurrency 4, customers asked before 8 in a row failed are still heard out', async () => {
    // down-0..7 fail at once; ok-8..10 are asked meanwhile and held until the
    // pass has stopped. ok-11 is the one customer never asked.
    const { gate, open } = makeGate();
    const held = new Set(['ok-8', 'ok-9', 'ok-10']);
    const taskWolf = fakeTaskWolf({
      gate: (customer) => (held.has(customer) ? gate : undefined),
      failWith: (customer) =>
        customer.startsWith('down')
          ? taskWolfDown('TW_NETWORK', `timed out for ${customer}`)
          : null,
    });
    const progress = [];
    const pass = enrichWithTaskWolf(
      platformSnapshot([...slugs('down', 8), 'ok-8', 'ok-9', 'ok-10', 'ok-11']),
      { client: taskWolf, concurrency: 4, onProgress: (p) => progress.push(p), now: () => NOW },
    );
    await until(() => progress.at(-1)?.scanned === 8);
    open();
    const snapshot = await pass;

    assert.equal(snapshot.taskWolf.error.code, 'TW_ABORTED');
    assert.match(
      snapshot.taskWolf.error.message,
      /^Task Wolf failed to answer for 8 customers in a row, so the pass stopped with 1 of 12 customers left\. Last failure: timed out for down-7$/,
    );
    // Every customer asked is either answered or listed; only ok-11 is neither.
    assert.equal(taskWolf.calls.length, 22);
    assert.ok(!taskWolf.calls.some((c) => c.args.customer === 'ok-11'));
    assert.equal(snapshot.taskWolf.customersAnswered, 3);
    assert.deepEqual(
      snapshot.customers.filter((c) => c.taskWolf).map((c) => c.slug),
      ['ok-8', 'ok-9', 'ok-10'],
    );
    assert.equal(snapshot.taskWolf.errors.filter((e) => e.workspaceName === 'ok-11').length, 0);
    assert.equal(progress.at(-1).scanned, 11);
  });

  test('at concurrency 4, the budget stops new asks but keeps the answers in flight', async () => {
    let clock = NOW;
    const { gate, open } = makeGate();
    const held = new Set(['held-1', 'held-2', 'held-3']);
    const taskWolf = fakeTaskWolf({
      gate: (customer) => (held.has(customer) ? gate : undefined),
      // The first customer's second call is where the budget runs out.
      onCall: (name, args) => {
        if (args.customer === 'two' && name === 'find_tasks') clock += 16 * 60 * 1000;
      },
    });
    const progress = [];
    const pass = enrichWithTaskWolf(
      platformSnapshot(['two', 'held-1', 'held-2', 'held-3', 'late-4', 'late-5']),
      {
        client: taskWolf,
        concurrency: 4,
        budgetMs: 15 * 60 * 1000,
        onProgress: (p) => progress.push(p),
        now: () => clock,
      },
    );
    await until(() => progress.at(-1)?.scanned === 1);
    open();
    const snapshot = await pass;

    assert.equal(snapshot.taskWolf.error.code, 'TW_ABORTED');
    assert.equal(
      snapshot.taskWolf.error.message,
      'The Task Wolf pass ran past its 15-minute budget, so it stopped with 2 of 6 customers left.',
    );
    assert.equal(taskWolf.calls.length, 8);
    assert.ok(!taskWolf.calls.some((c) => c.args.customer.startsWith('late')));
    assert.equal(snapshot.taskWolf.customersAnswered, 4);
    assert.equal(snapshot.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(progress.at(-1).scanned, 4);
  });

  test('at concurrency 4, an expired token stops new asks but keeps every answer already given', async () => {
    // two and held-1..2 are asked first and held; expired answers its first
    // call and gets a 401 on its second, all before the held ones come back.
    const { gate, open } = makeGate();
    const held = new Set(['two', 'held-1', 'held-2']);
    const taskWolf = fakeTaskWolf({
      gate: (customer) => (held.has(customer) ? gate : undefined),
      failWith: (customer, name) =>
        customer === 'expired' && name === 'find_tasks' ? new TaskWolfAuthError() : null,
    });
    const progress = [];
    const pass = enrichWithTaskWolf(
      platformSnapshot(['two', 'held-1', 'held-2', 'expired', 'late-4', 'late-5']),
      { client: taskWolf, concurrency: 4, onProgress: (p) => progress.push(p), now: () => NOW },
    );
    await until(() =>
      taskWolf.calls.some((c) => c.args.customer === 'expired' && c.name === 'find_tasks'),
    );
    // Let the 401 settle before anything held comes back.
    await new Promise((resolve) => setImmediate(resolve));
    open();
    const snapshot = await pass;

    assert.deepEqual(snapshot.taskWolf.error, {
      code: 'TW_AUTH',
      message: new TaskWolfAuthError().message,
    });
    assert.ok(!taskWolf.calls.some((c) => c.args.customer.startsWith('late')));
    // The three held answers, and the half expired gave before its 401.
    assert.equal(snapshot.taskWolf.customersAnswered, 4);
    assert.equal(snapshot.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(snapshot.customers[0].taskWolf.openTasks, 1);
    const expired = snapshot.customers.find((c) => c.slug === 'expired').taskWolf;
    assert.equal(expired.flowsInMaintenance, 0);
    assert.equal(expired.openTasks, null);
    assert.deepEqual(
      snapshot.taskWolf.errors
        .filter((e) => e.workspaceName === 'expired')
        .map((e) => [e.tool, e.message]),
      [['find_tasks', new TaskWolfAuthError().message]],
    );
    assert.equal(progress.at(-1).scanned, 4);
  });

  test('an expired token wins over a pass already cut short for another reason', async () => {
    // The budget runs out on two's second call; held-1, asked meanwhile, then gets a 401.
    let clock = NOW;
    const { gate, open } = makeGate();
    const taskWolf = fakeTaskWolf({
      gate: (customer) => (customer === 'held-1' ? gate : undefined),
      onCall: (name, args) => {
        if (args.customer === 'two' && name === 'find_tasks') clock += 16 * 60 * 1000;
      },
      failWith: (customer) => (customer === 'held-1' ? new TaskWolfAuthError() : null),
    });
    const progress = [];
    const pass = enrichWithTaskWolf(platformSnapshot(['two', 'held-1', 'late-2', 'late-3']), {
      client: taskWolf,
      concurrency: 2,
      budgetMs: 15 * 60 * 1000,
      onProgress: (p) => progress.push(p),
      now: () => clock,
    });
    await until(() => progress.at(-1)?.scanned === 1);
    open();
    const snapshot = await pass;
    assert.equal(snapshot.taskWolf.error.code, 'TW_AUTH');
    assert.equal(snapshot.taskWolf.customersAnswered, 1);
    assert.ok(!taskWolf.calls.some((c) => c.args.customer.startsWith('late')));
  });

  test('at concurrency 4, a cut-off with nobody left to ask stops nothing', async () => {
    // All nine are asked before the eighth failure settles, so the pass runs
    // to its end and says it got no answer, not that it left one customer.
    const taskWolf = fakeTaskWolf({ failWith: () => taskWolfDown('TW_NETWORK', 'timed out') });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(slugs('down', 9)), {
      client: taskWolf,
      concurrency: 4,
      now: () => NOW,
    });
    assert.equal(taskWolf.calls.length, 18);
    assert.equal(snapshot.taskWolf.error.code, 'TW_ABORTED');
    assert.match(
      snapshot.taskWolf.error.message,
      /^Task Wolf answered for none of the 9 customers asked\./,
    );
    assert.equal(snapshot.taskWolf.errors.length, 18);
  });
});

describe('enrichWithTaskWolf: a pass that ran to the end without one answer', () => {
  test('8 of 8 customers failing is not a clean pass, though nothing was cut short', async () => {
    const taskWolf = fakeTaskWolf({
      failWith: (customer, name) => taskWolfDown('TW_NETWORK', `${name} timed out for ${customer}`),
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(slugs('down', 8)), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(taskWolf.calls.length, 16);
    assert.deepEqual(snapshot.taskWolf.error, {
      code: 'TW_ABORTED',
      message:
        'Task Wolf answered for none of the 8 customers asked. First failure (down-0): get_maintenance_status timed out for down-0',
    });
    assert.equal(snapshot.taskWolf.customersAnswered, 0);
    assert.equal(snapshot.taskWolf.errors.length, 16);
    assert.equal(snapshot.totals.blockedFlows, null);
  });

  test('failures that are about the customer, or answers with nothing in them, count the same', async () => {
    const strangers = fakeTaskWolf({
      failWith: (customer) => taskWolfDown('TW_TOOL', `Task Wolf: no customer ${customer}`),
    });
    const unknown = await enrichWithTaskWolf(platformSnapshot(slugs('who', 12)), {
      client: strangers,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(strangers.calls.length, 24);
    assert.equal(unknown.taskWolf.error.code, 'TW_ABORTED');
    assert.equal(
      unknown.taskWolf.error.message,
      'Task Wolf answered for none of the 12 customers asked. First failure (who-0): Task Wolf: no customer who-0',
    );

    const prose = fakeTaskWolf({ answerWith: () => 'Nothing to report.' });
    const empty = await enrichWithTaskWolf(platformSnapshot(['two', 'three']), {
      client: prose,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(empty.taskWolf.error.code, 'TW_ABORTED');
    assert.match(
      empty.taskWolf.error.message,
      /^Task Wolf answered for none of the 2 customers asked\. First failure \(two\): get_maintenance_status gave an answer with no readable maintenance data/,
    );
  });

  test('one customer asked and not answered is worded for one', async () => {
    const taskWolf = fakeTaskWolf({ failing: new Set(['three']) });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['three']), {
      client: taskWolf,
      now: () => NOW,
    });
    assert.deepEqual(snapshot.taskWolf.error, {
      code: 'TW_ABORTED',
      message:
        'Task Wolf did not answer for the one customer asked. First failure (three): get_maintenance_status timed out for three',
    });
  });

  test('one answer is enough, and so is having nobody to ask', async () => {
    const taskWolf = fakeTaskWolf({
      failWith: (customer) => (customer === 'two' ? null : taskWolfDown('TW_NETWORK', 'timed out')),
    });
    const one = await enrichWithTaskWolf(platformSnapshot([...slugs('down', 5), 'two']), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(one.taskWolf.error, null);
    assert.equal(one.taskWolf.customersAnswered, 1);

    const nobody = await enrichWithTaskWolf(platformSnapshot([]), {
      client: fakeTaskWolf(),
      now: () => NOW,
    });
    assert.equal(nobody.taskWolf.error, null);
    assert.equal(nobody.taskWolf.customersQueried, 0);
  });

  test('a pass that was stopped keeps the reason it was stopped for', async () => {
    const expired = await enrichWithTaskWolf(platformSnapshot(slugs('down', 3)), {
      client: fakeTaskWolf({ authFailAfter: 0 }),
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(expired.taskWolf.error.code, 'TW_AUTH');
    assert.equal(expired.taskWolf.customersAnswered, 0);

    const down = await enrichWithTaskWolf(platformSnapshot(slugs('down', 12)), {
      client: fakeTaskWolf({ failWith: () => taskWolfDown('TW_NETWORK', 'timed out') }),
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(down.taskWolf.error.code, 'TW_ABORTED');
    assert.match(
      down.taskWolf.error.message,
      /^Task Wolf failed to answer for 8 customers in a row/,
    );
  });
});

/** Task Wolf's answer for a customer it has no record of, thrown as the client throws it. */
const noSuchCustomer = (customer, name) =>
  new TaskWolfToolError(
    `Task Wolf ${name}: No customer matched "${customer}". Use find_customer to search.`,
    { tool: name },
  );

describe('enrichWithTaskWolf: a customer Task Wolf has no record of', () => {
  test('is counted, not listed as a failure, and never trips the cut-off', async () => {
    const taskWolf = fakeTaskWolf({ failWith: noSuchCustomer });
    const progress = [];
    const snapshot = await enrichWithTaskWolf(
      {
        ...platformSnapshot(slugs('gone', 12)),
        reports: [
          { workspaceId: 'ws-gone-0', issueId: 'i-9', number: 9, flowIds: [], flowCount: 0 },
        ],
      },
      { client: taskWolf, concurrency: 1, onProgress: (p) => progress.push(p), now: () => NOW },
    );
    // Twelve in a row, past the cut-off of 8, and every one of them asked.
    assert.equal(taskWolf.calls.length, 24);
    // Not one of them known, though: that is the argument, not twelve former customers.
    assert.deepEqual(snapshot.taskWolf.error, {
      code: 'TW_ABORTED',
      message:
        'Task Wolf has no record of any of the 12 customers asked, so the customer argument it is sent is probably wrong. First (gone-0): get_maintenance_status was sent customer "gone-0".',
    });
    assert.deepEqual(snapshot.taskWolf.errors, []);
    assert.equal(snapshot.taskWolf.customersNotInTaskWolf, 12);
    assert.equal(snapshot.taskWolf.customersAnswered, 0);
    assert.equal(progress.at(-1).scanned, 12);
    assert.equal(progress.at(-1).failed, 0);
    assert.deepEqual([...new Set(snapshot.customers.map((c) => c.taskWolf))], [null]);
    assert.equal(snapshot.reports[0].taskWolf, null);
    assert.equal(snapshot.totals.blockedReports, 0);
    assert.equal(snapshot.totals.actionableReports, 0);
  });

  test('among other customers, it is counted apart from those answered and those failed', async () => {
    const taskWolf = fakeTaskWolf({
      failWith: (customer, name) => {
        if (customer === 'gone') return noSuchCustomer(customer, name);
        if (customer === 'down') return taskWolfDown('TW_NETWORK', `${name} timed out`);
        return null;
      },
    });
    const snapshot = await enrichWithTaskWolf(platformSnapshot(['two', 'gone', 'down']), {
      client: taskWolf,
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(taskWolf.calls.length, 6);
    assert.equal(snapshot.taskWolf.error, null);
    assert.equal(snapshot.taskWolf.customersAnswered, 1);
    assert.equal(snapshot.taskWolf.customersNotInTaskWolf, 1);
    assert.deepEqual(
      snapshot.taskWolf.errors.map((e) => e.workspaceName),
      ['down', 'down'],
    );
    assert.equal(snapshot.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(snapshot.customers[1].taskWolf, null);
  });

  test('a customer one tool knows is answered by that tool; one the other tool failed is still not in Task Wolf', async () => {
    const tasksDoNotKnow = await enrichWithTaskWolf(platformSnapshot(['two']), {
      client: fakeTaskWolf({
        failWith: (customer, name) =>
          name === 'find_tasks' ? noSuchCustomer(customer, name) : null,
      }),
      now: () => NOW,
    });
    assert.equal(tasksDoNotKnow.taskWolf.customersAnswered, 1);
    assert.equal(tasksDoNotKnow.taskWolf.customersNotInTaskWolf, 0);
    assert.deepEqual(tasksDoNotKnow.taskWolf.errors, []);
    assert.equal(tasksDoNotKnow.customers[0].taskWolf.blockedFlows, 1);
    assert.equal(tasksDoNotKnow.customers[0].taskWolf.openTasks, null);

    const statusDoesNotKnow = await enrichWithTaskWolf(platformSnapshot(['two']), {
      client: fakeTaskWolf({
        failWith: (customer, name) =>
          name === 'get_maintenance_status' ? noSuchCustomer(customer, name) : null,
      }),
      now: () => NOW,
    });
    assert.equal(statusDoesNotKnow.taskWolf.customersAnswered, 1);
    assert.equal(statusDoesNotKnow.taskWolf.customersNotInTaskWolf, 0);
    assert.deepEqual(statusDoesNotKnow.taskWolf.errors, []);
    assert.equal(statusDoesNotKnow.customers[0].taskWolf.blockedFlows, null);
    assert.equal(statusDoesNotKnow.customers[0].taskWolf.openTasks, 1);

    // Task Wolf said it has no such customer, and then timed out on the other
    // question: the customer is not in it, and the timeout is still a failure.
    const progress = [];
    const halfDown = await enrichWithTaskWolf(platformSnapshot(['gone', 'two']), {
      client: fakeTaskWolf({
        failWith: (customer, name) => {
          if (customer !== 'gone') return null;
          return name === 'get_maintenance_status'
            ? noSuchCustomer(customer, name)
            : taskWolfDown('TW_NETWORK', `${name} timed out`);
        },
      }),
      concurrency: 1,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    assert.equal(halfDown.taskWolf.error, null);
    assert.equal(halfDown.taskWolf.customersNotInTaskWolf, 1);
    assert.deepEqual(
      halfDown.taskWolf.errors.map((e) => [e.workspaceName, e.tool, e.message]),
      [['gone', 'find_tasks', 'find_tasks timed out']],
    );
    assert.equal(progress.at(-1).failed, 1);
  });

  test('a pass with no answer from any customer Task Wolf may have is still cut short', async () => {
    const failWith = (customer, name) =>
      customer.startsWith('gone')
        ? noSuchCustomer(customer, name)
        : taskWolfDown('TW_NETWORK', `${name} timed out for ${customer}`);
    const many = await enrichWithTaskWolf(
      platformSnapshot([...slugs('gone', 2), ...slugs('down', 3)]),
      {
        client: fakeTaskWolf({ failWith }),
        concurrency: 1,
        now: () => NOW,
      },
    );
    assert.deepEqual(many.taskWolf.error, {
      code: 'TW_ABORTED',
      message:
        'Of the 5 customers asked, Task Wolf has no record of 2 and answered for none of the other 3. First failure (down-0): get_maintenance_status timed out for down-0',
    });
    assert.equal(many.taskWolf.customersNotInTaskWolf, 2);

    const one = await enrichWithTaskWolf(platformSnapshot(['gone', 'down']), {
      client: fakeTaskWolf({ failWith }),
      concurrency: 1,
      now: () => NOW,
    });
    assert.match(
      one.taskWolf.error.message,
      /^Of the 2 customers asked, Task Wolf has no record of 1 and did not answer for the other one\. First failure \(down\): /,
    );
  });

  test('a pass in which it knows no one names the argument sent; one former customer, or one known, is clean', async () => {
    const byQawId = {
      type: 'object',
      properties: { customer: { type: 'string', description: 'Customer name, slug, or qawId' } },
      required: ['customer'],
    };
    const tools = [
      { name: 'get_maintenance_status', inputSchema: byQawId },
      { name: 'find_tasks', inputSchema: byQawId },
    ];
    const nobody = await enrichWithTaskWolf(platformSnapshot(slugs('gone', 3)), {
      client: fakeTaskWolf({ tools, failWith: noSuchCustomer }),
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(nobody.taskWolf.error.code, 'TW_ABORTED');
    assert.match(
      nobody.taskWolf.error.message,
      / of the 3 customers asked, .* First \(gone-0\): get_maintenance_status was sent customer "ws-gone-0"\.$/,
    );

    const oneGone = await enrichWithTaskWolf(platformSnapshot(['gone']), {
      client: fakeTaskWolf({ failWith: noSuchCustomer }),
      now: () => NOW,
    });
    assert.equal(oneGone.taskWolf.error, null);
    assert.equal(oneGone.taskWolf.customersNotInTaskWolf, 1);

    const oneKnown = await enrichWithTaskWolf(platformSnapshot([...slugs('gone', 11), 'two']), {
      client: fakeTaskWolf({
        failWith: (customer, name) => (customer === 'two' ? null : noSuchCustomer(customer, name)),
      }),
      concurrency: 1,
      now: () => NOW,
    });
    assert.equal(oneKnown.taskWolf.error, null);
    assert.equal(oneKnown.taskWolf.customersAnswered, 1);
    assert.equal(oneKnown.taskWolf.customersNotInTaskWolf, 11);
  });
});

// What an invalid key looks like: `whoami` itself is refused.
const rejectedKeyClient = () => ({
  listWorkspaces: async () => {
    throw new QawAuthError();
  },
  listOpenMaintenanceReports: async () => [],
});

/** A promise that stays open until `open()` is called, to hold a scan mid-way. */
function makeGate() {
  let open;
  const gate = new Promise((resolve) => {
    open = resolve;
  });
  return { gate, open };
}

/** Let the scan in flight run until `condition` holds. */
async function until(condition) {
  for (let turn = 0; turn < 1000 && !condition(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(condition(), 'the scan never got that far');
}

/**
 * A GET starts its scans with the default client, which reads the key from
 * the environment and throws before any request when there is none. The keys
 * are cleared at the top of this file, so that path is the misconfigured
 * deployment.
 */
describe('getMaintenanceDashboard', () => {
  beforeEach(() => {
    resetMaintenanceCache();
    // Every failed scan is logged; here they are the point, not news.
    mock.method(console, 'error', () => {});
  });

  afterEach(() => mock.restoreAll());

  // `startRefresh()` hands back the scan in flight, so this waits for the one
  // a GET just started rather than starting another.
  const scanInFlightFails = (code) =>
    assert.rejects(startRefresh(), (error) => error.code === code);

  test('with no key, the GET after the failed scan answers QAW_CONFIG and keeps answering it', async () => {
    // The first call still answers "building": the scan is in flight when we ask.
    assert.equal(getMaintenanceDashboard().status, 'building');
    await scanInFlightFails('QAW_CONFIG');

    for (let i = 0; i < 3; i += 1) {
      const result = getMaintenanceDashboard();
      assert.equal(result.status, 'error');
      assert.equal(result.error.code, 'QAW_CONFIG');
      assert.match(result.error.message, /QAW_BEARER_TOKEN is not configured/);
    }
  });

  test('a rejected key answers QAW_AUTH instead of an endless first scan', async () => {
    await assert.rejects(startRefresh({ client: rejectedKeyClient() }));
    const result = getMaintenanceDashboard();
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'QAW_AUTH');
    assert.equal(result.progress, undefined);
  });

  test('a failure without a code of its own is reported as SCAN_FAILED', async () => {
    const client = {
      listWorkspaces: async () => {
        throw new Error('Unexpected whoami shape. Got keys: nope');
      },
      listOpenMaintenanceReports: async () => [],
    };
    await assert.rejects(startRefresh({ client }));
    const result = getMaintenanceDashboard();
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'SCAN_FAILED');
    assert.match(result.error.message, /whoami shape/);
  });

  test('an explicit refresh retries once the cool-down has passed, and a scan that works clears the error', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    await assert.rejects(startRefresh({ client: rejectedKeyClient() }));
    assert.equal(getMaintenanceDashboard().status, 'error');

    // `?refresh=1` inside the cool-down starts nothing.
    assert.equal(getMaintenanceDashboard({ refresh: true }).status, 'error');

    // Once it has passed, a new scan starts.
    t.mock.timers.tick(getRetryCooldownMs());
    assert.equal(getMaintenanceDashboard({ refresh: true }).status, 'building');
    await scanInFlightFails('QAW_CONFIG');
    assert.equal(getMaintenanceDashboard().error.code, 'QAW_CONFIG');

    // `POST /refresh`, this time with a key that works.
    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    const ready = getMaintenanceDashboard();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.refreshError, null);
    assert.equal(ready.refreshing, false);
    assert.equal(ready.snapshot.customers.length, 1);
  });

  test('a plain GET retries on its own once the cool-down has passed, not before', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    await assert.rejects(startRefresh({ client: rejectedKeyClient() }));

    t.mock.timers.tick(getRetryCooldownMs() - 1);
    assert.equal(getMaintenanceDashboard().status, 'error');

    t.mock.timers.tick(1);
    assert.equal(getMaintenanceDashboard().status, 'building');
    await scanInFlightFails('QAW_CONFIG');

    // The retry failed too, so the cool-down starts over from that failure.
    assert.equal(getMaintenanceDashboard().status, 'error');
  });

  test('a stale snapshot keeps answering, with the failed rebuild beside it', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    const fresh = getMaintenanceDashboard();
    assert.equal(fresh.status, 'ready');
    assert.equal(fresh.stale, false);
    assert.equal(fresh.refreshing, false);
    assert.equal(fresh.refreshError, null);

    // Past the cache window the GET starts a rebuild and still answers.
    t.mock.timers.tick(getCacheTtlMs() + 1);
    const rebuilding = getMaintenanceDashboard();
    assert.equal(rebuilding.status, 'ready');
    assert.equal(rebuilding.stale, true);
    assert.equal(rebuilding.refreshing, true);
    await scanInFlightFails('QAW_CONFIG');
    const failedAt = new Date(NOW + getCacheTtlMs() + 1).toISOString();

    // The rebuild failed: same snapshot, the failure beside it, no new scan.
    t.mock.timers.tick(1000);
    const after = getMaintenanceDashboard();
    assert.equal(after.status, 'ready');
    assert.equal(after.stale, true);
    assert.equal(after.refreshing, false);
    assert.equal(after.builtAt, fresh.builtAt);
    assert.equal(after.snapshot, fresh.snapshot);
    assert.equal(after.refreshError.code, 'QAW_CONFIG');
    assert.match(after.refreshError.message, /QAW_BEARER_TOKEN is not configured/);
    assert.equal(after.refreshError.failedAt, failedAt);

    // Rescan waits out the cool-down like a plain GET, then retries.
    assert.equal(getMaintenanceDashboard({ refresh: true }).refreshing, false);
    t.mock.timers.tick(getRetryCooldownMs());
    assert.equal(getMaintenanceDashboard({ refresh: true }).refreshing, true);
    await scanInFlightFails('QAW_CONFIG');
    t.mock.timers.tick(getRetryCooldownMs());
    assert.equal(getMaintenanceDashboard().refreshing, true);
    await scanInFlightFails('QAW_CONFIG');
  });

  test('a forced rescan waits the minimum gap after a good scan, and says when it may start', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    const availableAt = new Date(NOW + getMinRescanMs()).toISOString();
    assert.equal(getMaintenanceDashboard().rescanAvailableAt, availableAt);
    assert.equal(getMaintenanceStatus().rescanAvailableAt, availableAt);

    // Too soon: nothing starts, under `?refresh=1` or `POST /refresh`.
    t.mock.timers.tick(getMinRescanMs() - 1);
    assert.equal(getMaintenanceDashboard({ refresh: true }).refreshing, false);
    assert.deepEqual(requestRescan(), { accepted: false, retryAfterMs: 1 });
    assert.equal(getMaintenanceStatus().refreshing, false);

    // The gap has passed: one scan starts, and asking again joins it.
    t.mock.timers.tick(1);
    assert.equal(getMaintenanceDashboard().rescanAvailableAt, null);
    assert.deepEqual(requestRescan(), { accepted: true, retryAfterMs: 0 });
    const running = startRefresh();
    assert.deepEqual(requestRescan(), { accepted: true, retryAfterMs: 0 });
    assert.equal(startRefresh(), running);
    await assert.rejects(running, (error) => error.code === 'QAW_CONFIG');
  });

  test('the minimum gap comes from the environment, 15 minutes by default', (t) => {
    assert.equal(getMinRescanMs(), 15 * 60 * 1000);
    process.env.MAINTENANCE_DASHBOARD_MIN_RESCAN_MINUTES = '5';
    t.after(() => delete process.env.MAINTENANCE_DASHBOARD_MIN_RESCAN_MINUTES);
    assert.equal(getMinRescanMs(), 5 * 60 * 1000);
  });

  test('with nothing cached and nothing failed, a forced rescan starts at once', () => {
    assert.equal(getMaintenanceStatus().rescanAvailableAt, null);
    assert.deepEqual(requestRescan(), { accepted: true, retryAfterMs: 0 });
    return assert.rejects(startRefresh(), (error) => error.code === 'QAW_CONFIG');
  });

  test('a failed explicit refresh of a fresh snapshot is surfaced without restarting', async () => {
    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    await assert.rejects(startRefresh({ client: rejectedKeyClient() }));
    const result = getMaintenanceDashboard();
    assert.equal(result.status, 'ready');
    assert.equal(result.stale, false);
    assert.equal(result.refreshing, false);
    assert.equal(result.refreshError.code, 'QAW_AUTH');
  });

  test('a first scan in which every workspace failed is an error, not an empty backlog', async () => {
    await assert.rejects(
      startRefresh({ client: fakeClient({ failWith: upstream500 }), taskWolfClient: null }),
    );
    const result = getMaintenanceDashboard();
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'QAW_UPSTREAM');
    assert.match(result.error.message, /^All 3 workspaces scanned failed\. First failure \(One\)/);
  });

  test('a rescan in which every workspace failed leaves the snapshot in place', async () => {
    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    const good = getMaintenanceDashboard();
    assert.equal(good.snapshot.reports.length, 1);

    await assert.rejects(
      startRefresh({
        client: fakeClient({ failWith: (id) => new QawForbiddenError(`403 for ${id}`) }),
        taskWolfClient: null,
      }),
      (error) => error.code === 'QAW_FORBIDDEN',
    );
    const after = getMaintenanceDashboard();
    assert.equal(after.status, 'ready');
    assert.equal(after.snapshot, good.snapshot);
    assert.equal(after.builtAt, good.builtAt);
    assert.equal(after.refreshing, false);
    assert.equal(after.refreshError.code, 'QAW_FORBIDDEN');
    assert.match(after.refreshError.message, /^All 3 workspaces scanned failed/);
  });

  test('a rescan whose whoami lists no workspace with an id leaves the snapshot in place', async () => {
    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    const good = getMaintenanceDashboard();

    const renamed = workspaces.map(({ id, ...rest }) => ({ ...rest, teamId: id }));
    await assert.rejects(
      startRefresh({ client: fakeClient({ listed: renamed }), taskWolfClient: null }),
      (error) => error.code === 'QAW_UPSTREAM',
    );
    const after = getMaintenanceDashboard();
    assert.equal(after.status, 'ready');
    assert.equal(after.snapshot, good.snapshot);
    assert.equal(after.snapshot.reports.length, 1);
    assert.equal(after.refreshError.code, 'QAW_UPSTREAM');
    assert.match(after.refreshError.message, /QA Wolf listed 4 workspaces and none had an id/);
  });
});

describe('the snapshot while Task Wolf is asked', () => {
  beforeEach(() => {
    resetMaintenanceCache();
    mock.method(console, 'error', () => {});
  });

  afterEach(() => mock.restoreAll());

  test('the first scan publishes the platform snapshot, pending, before the pass starts', async () => {
    const { gate, open } = makeGate();
    const taskWolf = fakeTaskWolf({ gate });
    const building = startRefresh({ client: fakeClient(), taskWolfClient: taskWolf });
    await until(() => taskWolf.calls.length > 0);

    const interim = getMaintenanceDashboard();
    assert.equal(interim.status, 'ready');
    assert.equal(interim.stale, false);
    assert.equal(interim.refreshing, true);
    assert.equal(interim.progress.phase, 'taskwolf');
    assert.equal(interim.snapshot.taskWolf.enabled, true);
    assert.equal(interim.snapshot.taskWolf.pending, true);
    assert.equal(interim.snapshot.taskWolf.error, null);
    assert.equal(interim.snapshot.taskWolf.customersQueried, 1);
    assert.equal(interim.snapshot.taskWolf.customersAnswered, 0);
    assert.equal(interim.snapshot.taskWolf.customersPartial, 0);
    assert.equal(interim.snapshot.totals.openReports, 1);
    // Nobody has counted yet: unknown, not zero.
    assert.equal(interim.snapshot.totals.blockedFlows, null);
    assert.equal(interim.snapshot.totals.actionableFlows, null);
    assert.equal(interim.snapshot.customers[0].name, 'Two');
    assert.equal(interim.snapshot.customers[0].taskWolf, null);
    assert.equal(interim.snapshot.reports[0].taskWolf, null);
    // Asking did not start a second scan on top of the one in flight.
    assert.equal(startRefresh(), building);

    open();
    const published = await building;
    const done = getMaintenanceDashboard();
    assert.equal(done.snapshot, published);
    assert.notEqual(done.snapshot, interim.snapshot);
    assert.equal(done.refreshing, false);
    assert.equal(done.progress, null);
    assert.equal(done.snapshot.taskWolf.pending, false);
    assert.equal(done.snapshot.taskWolf.customersAnswered, 1);
    assert.equal(done.snapshot.customers[0].taskWolf.blockedFlows, 1);
  });

  test('without a Task Wolf client nothing is pending and nothing is published early', async () => {
    const seen = [];
    await scanMaintenanceBacklog({
      client: fakeClient(),
      taskWolfClient: null,
      onPlatformSnapshot: (snapshot) => seen.push(snapshot),
      now: () => NOW,
    });
    assert.deepEqual(seen, []);

    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    const { snapshot } = getMaintenanceDashboard();
    assert.equal(snapshot.taskWolf.enabled, false);
    assert.equal(snapshot.taskWolf.pending, false);
  });

  test('a rescan leaves the snapshot in place until the new one is complete', async () => {
    await startRefresh({ client: fakeClient(), taskWolfClient: fakeTaskWolf() });
    const first = getMaintenanceDashboard();

    const { gate, open } = makeGate();
    const taskWolf = fakeTaskWolf({ gate });
    const rescan = startRefresh({ client: fakeClient(), taskWolfClient: taskWolf });
    await until(() => taskWolf.calls.length > 0);

    const during = getMaintenanceDashboard();
    assert.equal(during.snapshot, first.snapshot);
    assert.equal(during.builtAt, first.builtAt);
    assert.equal(during.refreshing, true);
    assert.equal(during.snapshot.taskWolf.pending, false);
    assert.equal(during.snapshot.customers[0].taskWolf.blockedFlows, 1);

    open();
    await rescan;
    const after = getMaintenanceDashboard();
    assert.notEqual(after.snapshot, first.snapshot);
    assert.equal(after.refreshing, false);
  });

  test('a pass that gives up replaces the interim snapshot with what it gathered', async () => {
    const taskWolf = fakeTaskWolf({ authFailAfter: 0 });
    await startRefresh({ client: fakeClient(), taskWolfClient: taskWolf });
    const { snapshot, refreshError } = getMaintenanceDashboard();
    assert.equal(snapshot.taskWolf.pending, false);
    assert.equal(snapshot.taskWolf.error.code, 'TW_AUTH');
    assert.equal(snapshot.totals.openReports, 1);
    assert.equal(refreshError, null);
  });

  test('a scan that breaks after the interim snapshot does not leave it pending', async () => {
    // Nothing Task Wolf answers can break the pass, so the scan is broken
    // from inside: a clock that fails once the interim snapshot is out.
    const now = () => {
      if (getMaintenanceStatus().status === 'ready') throw new Error('clock stopped');
      return NOW;
    };
    await assert.rejects(
      startRefresh({ client: fakeClient(), taskWolfClient: fakeTaskWolf(), now }),
      /clock stopped/,
    );
    const result = getMaintenanceDashboard();
    assert.equal(result.status, 'ready');
    assert.equal(result.refreshing, false);
    assert.equal(result.snapshot.totals.openReports, 1);
    assert.equal(result.snapshot.taskWolf.pending, false);
    assert.equal(result.snapshot.taskWolf.error.code, 'SCAN_FAILED');
    assert.equal(result.snapshot.taskWolf.customersPartial, 0);
    assert.equal(result.refreshError.code, 'SCAN_FAILED');
  });
});

describe('the published snapshot', () => {
  beforeEach(() => resetMaintenanceCache());

  const PAGE_READS = [
    'flowsInMaintenance',
    'blockedFlows',
    'actionableFlows',
    'partial',
    'assignees',
    'openTasks',
    'blockedTasks',
    'overdueTasks',
    'oldestTaskAgeDays',
    'blockers',
    'truncated',
    'url',
  ];
  // What annotates the reports during the scan, and nothing reads afterwards.
  const SCAN_ONLY = ['listedFlowIds', 'blockedFlowIds', 'flowBlockers', 'flowAssignees', 'tasks'];
  const REPORT_VERDICT = [
    'blocked',
    'blockedFlows',
    'actionableFlows',
    'unlistedFlows',
    'blockedFlowIds',
    'freeFlowIds',
    'partial',
    'blockerTitle',
    'assignees',
    'customerAssignees',
    'openTasks',
  ];
  const PASS_FIELDS = [
    'enabled',
    'pending',
    'error',
    'errors',
    'customersQueried',
    'customersAnswered',
    'customersPartial',
    'customersNotInTaskWolf',
    'startedAt',
    'finishedAt',
    'tools',
  ];

  const sorted = (keys) => [...keys].sort();
  // The snapshot as a response carries it: a key holding undefined is no key.
  const asSent = (snapshot) => JSON.parse(JSON.stringify(snapshot));
  const fieldsOf = (snapshot) => ({
    snapshot: sorted(Object.keys(snapshot)),
    totals: sorted(Object.keys(snapshot.totals)),
    taskWolf: sorted(Object.keys(snapshot.taskWolf)),
    customer: sorted(Object.keys(snapshot.customers[0])),
    report: sorted(Object.keys(snapshot.reports[0])),
  });

  test('a customer’s Task Wolf roll-up is cut down to what the page reads', async () => {
    const scanned = await scanMaintenanceBacklog({
      client: fakeClient(),
      taskWolfClient: fakeTaskWolf(),
      now: () => NOW,
    });
    // The scan itself works from the whole roll-up.
    for (const key of SCAN_ONLY) assert.equal(key in scanned.customers[0].taskWolf, true, key);
    assert.equal(scanned.customers[0].taskWolf.tasks.length, 1);
    assert.deepEqual(scanned.customers[0].taskWolf.blockedFlowIds, ['f1']);

    const published = await startRefresh({ client: fakeClient(), taskWolfClient: fakeTaskWolf() });
    const { snapshot } = getMaintenanceDashboard();
    assert.equal(snapshot, published);
    const rollUp = snapshot.customers[0].taskWolf;
    assert.deepEqual(sorted(Object.keys(asSent(rollUp))), sorted(PAGE_READS));
    for (const dropped of SCAN_ONLY) assert.equal(dropped in rollUp, false, dropped);
    assert.equal(rollUp.flowsInMaintenance, 2);
    assert.equal(rollUp.blockedFlows, 1);
    assert.equal(rollUp.actionableFlows, 1);
    assert.equal(rollUp.partial, false);
    assert.equal(rollUp.truncated, false);
    assert.equal(rollUp.openTasks, 1);
    assert.deepEqual(rollUp.assignees, ['Kalley']);
    assert.deepEqual(
      rollUp.blockers.map((b) => b.title),
      ['Staging down'],
    );
    assert.equal(snapshot.totals.blockedFlows, 1);
    assert.equal(snapshot.totals.actionableFlows, 1);
  });

  test('a report’s verdict reaches the page whole, its own QAEs apart from the customer’s', async () => {
    await startRefresh({ client: fakeClient(), taskWolfClient: fakeTaskWolf() });
    const { snapshot } = getMaintenanceDashboard();
    // Annotated from the whole roll-up, per-flow assignees included, before it was cut.
    assert.deepEqual(asSent(snapshot.reports[0].taskWolf), {
      blocked: false,
      blockedFlows: 1,
      actionableFlows: 1,
      unlistedFlows: 0,
      blockedFlowIds: ['f1'],
      freeFlowIds: ['f2'],
      partial: false,
      blockerTitle: '',
      assignees: ['Marta'],
      customerAssignees: ['Kalley'],
      openTasks: 1,
    });
    assert.deepEqual(sorted(Object.keys(snapshot.reports[0].taskWolf)), sorted(REPORT_VERDICT));
    assert.equal(snapshot.totals.blockedReports, 0);
    assert.equal(snapshot.totals.actionableReports, 1);
    assert.equal(snapshot.totals.reportsWithQae, 1);
  });

  test('counts that are floors say so, and what nobody counted stays null', async () => {
    // Five flows in maintenance, one of them listed: the list was cut short.
    const taskWolf = fakeTaskWolf({
      answerWith: (customer, name) =>
        name === 'get_maintenance_status'
          ? { total: 5, truncated: true, items: [{ flowId: 'f1', blocked: true }] }
          : undefined,
    });
    await startRefresh({ client: fakeClient(), taskWolfClient: taskWolf });
    const snapshot = asSent(getMaintenanceDashboard().snapshot);

    const rollUp = snapshot.customers[0].taskWolf;
    assert.equal(rollUp.partial, true);
    assert.equal(rollUp.truncated, true);
    assert.equal(rollUp.flowsInMaintenance, 5);
    assert.equal(rollUp.blockedFlows, 1);
    assert.equal(rollUp.actionableFlows, null);
    assert.equal(snapshot.taskWolf.customersPartial, 1);
    assert.equal(snapshot.totals.blockedFlows, 1);
    assert.equal(snapshot.totals.actionableFlows, null);

    // f1 is blocked and f2 was not on the list, so the report is unknown.
    const verdict = snapshot.reports[0].taskWolf;
    assert.equal(verdict.blocked, null);
    assert.equal(verdict.partial, true);
    assert.equal(verdict.blockedFlows, 1);
    assert.equal(verdict.actionableFlows, 0);
    assert.equal(verdict.unlistedFlows, 1);
    assert.equal(snapshot.totals.blockedReports, 0);
    assert.equal(snapshot.totals.actionableReports, 0);
  });

  test('the pass itself is reported in full, and the probe route can still find a customer', async () => {
    await startRefresh({ client: fakeClient(), taskWolfClient: fakeTaskWolf() });
    const { snapshot } = getMaintenanceDashboard();
    assert.deepEqual(sorted(Object.keys(asSent(snapshot.taskWolf))), sorted(PASS_FIELDS));
    assert.equal(snapshot.taskWolf.customersPartial, 0);
    assert.deepEqual(snapshot.taskWolf.tools, { maintenance: true, tasks: true });

    const cached = findCachedCustomer('ws-2');
    assert.equal(cached.slug, 'two');
    assert.equal(cached.name, 'Two');
    assert.equal(findCachedCustomer('ws-nowhere'), null);
  });

  test('a customer Task Wolf has no record of goes out counted, not as a failure', async () => {
    await startRefresh({
      client: fakeClient(),
      taskWolfClient: fakeTaskWolf({ failWith: noSuchCustomer }),
    });
    const snapshot = asSent(getMaintenanceDashboard().snapshot);
    assert.equal(snapshot.taskWolf.customersNotInTaskWolf, 1);
    assert.equal(snapshot.taskWolf.customersAnswered, 0);
    assert.equal(snapshot.taskWolf.error, null);
    assert.deepEqual(snapshot.taskWolf.errors, []);
    assert.equal(snapshot.customers[0].taskWolf, null);
    assert.equal(snapshot.reports[0].taskWolf, null);
  });

  test('interim, finished, cut short or not connected, a snapshot carries the same fields', async (t) => {
    const saved = process.env.TASK_WOLF_MAX_CONSECUTIVE_FAILURES;
    t.after(() => {
      if (saved === undefined) delete process.env.TASK_WOLF_MAX_CONSECUTIVE_FAILURES;
      else process.env.TASK_WOLF_MAX_CONSECUTIVE_FAILURES = saved;
    });
    process.env.TASK_WOLF_MAX_CONSECUTIVE_FAILURES = '2';

    // Six customers with the same backlog, Two ranked first by its name.
    const listed = [workspaces[1], ...manyWorkspaces(5)];
    const client = {
      listWorkspaces: async () => listed,
      listOpenMaintenanceReports: async () => fakeClient().listOpenMaintenanceReports('ws-2'),
    };

    const { gate, open } = makeGate();
    const answering = fakeTaskWolf({ gate });
    const building = startRefresh({ client, taskWolfClient: answering, taskWolfConcurrency: 1 });
    await until(() => answering.calls.length > 0);
    const interim = asSent(getMaintenanceDashboard().snapshot);
    open();
    const finished = asSent(await building);
    assert.equal(interim.taskWolf.pending, true);
    assert.equal(finished.taskWolf.pending, false);
    assert.equal(finished.taskWolf.customersAnswered, 6);

    resetMaintenanceCache();
    const down = fakeTaskWolf({
      failWith: (customer) => (customer === 'two' ? null : taskWolfDown('TW_NETWORK', 'timed out')),
    });
    const cutShort = asSent(
      await startRefresh({ client, taskWolfClient: down, taskWolfConcurrency: 1 }),
    );
    assert.equal(cutShort.taskWolf.error.code, 'TW_ABORTED');
    assert.match(cutShort.taskWolf.error.message, /stopped with 3 of 6 customers left/);
    assert.equal(cutShort.taskWolf.pending, false);
    assert.equal(cutShort.taskWolf.customersAnswered, 1);

    resetMaintenanceCache();
    const notConnected = asSent(await startRefresh({ client, taskWolfClient: null }));
    assert.equal(notConnected.taskWolf.error.code, 'TW_CONFIG');

    const expected = fieldsOf(finished);
    assert.deepEqual(expected.taskWolf, sorted(PASS_FIELDS));
    for (const [name, snapshot] of Object.entries({ interim, cutShort, notConnected })) {
      assert.deepEqual(fieldsOf(snapshot), expected, name);
    }
    // Nobody asked has said it does not know a customer.
    for (const snapshot of [interim, finished, cutShort, notConnected]) {
      assert.equal(snapshot.taskWolf.customersNotInTaskWolf, 0);
    }

    // Where the pass got an answer the rows read as in any other snapshot;
    // where it did not, or never asked, they are null.
    const [two, ...rest] = cutShort.customers;
    assert.equal(two.name, 'Two');
    assert.deepEqual(sorted(Object.keys(two.taskWolf)), sorted(PAGE_READS));
    assert.deepEqual(
      rest.map((c) => c.taskWolf),
      [null, null, null, null, null],
    );
    for (const report of cutShort.reports) {
      if (report.workspaceId === 'ws-2') {
        assert.deepEqual(sorted(Object.keys(report.taskWolf)), sorted(REPORT_VERDICT));
      } else {
        assert.equal(report.taskWolf, null);
      }
    }
    for (const snapshot of [interim, notConnected]) {
      assert.deepEqual([...new Set(snapshot.customers.map((c) => c.taskWolf))], [null]);
      assert.deepEqual([...new Set(snapshot.reports.map((r) => r.taskWolf))], [null]);
    }
  });
});

describe('getMaintenanceStatus', () => {
  beforeEach(() => {
    resetMaintenanceCache();
    mock.method(console, 'error', () => {});
  });

  afterEach(() => mock.restoreAll());

  const FIELDS = [
    'builtAt',
    'error',
    'progress',
    'refreshError',
    'refreshing',
    'rescanAvailableAt',
    'stale',
    'status',
  ];

  test('with nothing cached and nothing running it says so, and starts nothing', () => {
    for (let i = 0; i < 2; i += 1) {
      assert.deepEqual(getMaintenanceStatus(), {
        status: 'error',
        builtAt: null,
        stale: false,
        refreshing: false,
        progress: null,
        refreshError: null,
        rescanAvailableAt: null,
        error: { code: 'NO_SNAPSHOT', message: 'No snapshot available.' },
      });
    }
  });

  test('during the first scan it answers building, with the progress', async () => {
    const { gate, open } = makeGate();
    const client = fakeClient();
    const building = startRefresh({
      client: {
        listWorkspaces: client.listWorkspaces,
        listOpenMaintenanceReports: async (workspaceId) => {
          await gate;
          return client.listOpenMaintenanceReports(workspaceId);
        },
      },
      taskWolfClient: null,
    });
    await until(() => getMaintenanceStatus().progress.total === 3);

    const status = getMaintenanceStatus();
    assert.deepEqual(Object.keys(status).sort(), FIELDS);
    assert.equal(status.status, 'building');
    assert.equal(status.builtAt, null);
    assert.equal(status.stale, false);
    assert.equal(status.refreshing, true);
    assert.equal(status.progress.phase, 'platform');
    assert.equal(status.progress.scanned, 0);
    assert.equal(status.refreshError, null);
    assert.equal(status.error, null);

    open();
    await building;
    assert.equal(getMaintenanceStatus().status, 'ready');
  });

  test('with a snapshot it answers ready and never carries the snapshot', async () => {
    await startRefresh({ client: fakeClient(), taskWolfClient: fakeTaskWolf() });
    const full = getMaintenanceDashboard();
    const status = getMaintenanceStatus();
    assert.deepEqual(status, {
      status: 'ready',
      builtAt: full.builtAt,
      stale: false,
      refreshing: false,
      progress: null,
      refreshError: null,
      rescanAvailableAt: new Date(Date.parse(full.builtAt) + getMinRescanMs()).toISOString(),
      error: null,
    });
    assert.ok(JSON.stringify(status).length < 300);
  });

  test('builtAt moves when the interim snapshot goes out and again when the pass ends', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const { gate, open } = makeGate();
    const taskWolf = fakeTaskWolf({ gate });
    const building = startRefresh({ client: fakeClient(), taskWolfClient: taskWolf });
    await until(() => taskWolf.calls.length > 0);

    const during = getMaintenanceStatus();
    assert.equal(during.status, 'ready');
    assert.equal(during.builtAt, new Date(NOW).toISOString());
    assert.equal(during.refreshing, true);
    assert.equal(during.progress.phase, 'taskwolf');

    t.mock.timers.tick(90 * 1000);
    open();
    await building;
    const after = getMaintenanceStatus();
    assert.equal(after.builtAt, new Date(NOW + 90 * 1000).toISOString());
    assert.equal(after.refreshing, false);
    assert.equal(after.progress, null);
  });

  test('a failed first scan is the error, under 200, and is not retried by asking', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    await assert.rejects(startRefresh({ client: rejectedKeyClient() }));

    // Past the cool-down a GET of the full payload would retry; this does not.
    t.mock.timers.tick(getRetryCooldownMs() + 1);
    const status = getMaintenanceStatus();
    assert.equal(status.status, 'error');
    assert.equal(status.refreshing, false);
    assert.equal(status.refreshError, null);
    assert.deepEqual(Object.keys(status.error).sort(), ['code', 'message']);
    assert.equal(status.error.code, 'QAW_AUTH');
    assert.match(status.error.message, /invalid or expired/);
    assert.equal(getMaintenanceStatus().refreshing, false);
  });

  test('a stale snapshot that nothing went wrong with is not rebuilt by asking', async (t) => {
    // The everyday case: an idle tab polling past the cache window.
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const client = fakeClient();
    await startRefresh({ client, taskWolfClient: null });
    const { builtAt } = getMaintenanceDashboard();
    const asked = client.calls.length;

    // Past the cache window, where the full payload would rebuild.
    t.mock.timers.tick(getCacheTtlMs() + 1);
    for (let i = 0; i < 2; i += 1) {
      assert.deepEqual(getMaintenanceStatus(), {
        status: 'ready',
        builtAt,
        stale: true,
        refreshing: false,
        progress: null,
        refreshError: null,
        rescanAvailableAt: null,
        error: null,
      });
    }
    assert.equal(client.calls.length, asked);
  });

  test('a stale snapshot with a failed rebuild says both, and is not rebuilt by asking', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    await startRefresh({ client: fakeClient(), taskWolfClient: null });
    t.mock.timers.tick(1000);
    await assert.rejects(startRefresh({ client: rejectedKeyClient() }));
    const full = getMaintenanceDashboard();
    assert.equal(full.refreshError.failedAt, new Date(NOW + 1000).toISOString());

    // Past the cache window and the cool-down, where the full payload would rebuild.
    t.mock.timers.tick(getCacheTtlMs() + 1);
    for (let i = 0; i < 2; i += 1) {
      const status = getMaintenanceStatus();
      assert.equal(status.status, 'ready');
      assert.equal(status.builtAt, full.builtAt);
      assert.equal(status.stale, true);
      assert.equal(status.refreshing, false);
      assert.equal(status.error, null);
      assert.deepEqual(status.refreshError, full.refreshError);
      assert.equal(status.refreshError.code, 'QAW_AUTH');
    }
  });
});

/**
 * The route's own handler, past the session check, and a `res` that records
 * what it was told. Nothing listens on a port.
 */
function routeHandler(method, path) {
  const layer = maintenanceRouter.stack.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  return layer.route.stack.at(-1).handle;
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('the routes', () => {
  beforeEach(() => {
    resetMaintenanceCache();
    mock.method(console, 'error', () => {});
  });

  afterEach(() => mock.restoreAll());

  test('each failure code answers under its HTTP status', () => {
    const table = {
      QAW_AUTH: 401,
      TW_AUTH: 401,
      QAW_CONFIG: 500,
      TW_CONFIG: 500,
      // Upstream refused our key or failed: a bad gateway, not the caller's fault.
      TW_TOOL: 502,
      QAW_FORBIDDEN: 502,
      TW_FORBIDDEN: 502,
      QAW_NETWORK: 502,
      TW_NETWORK: 502,
      QAW_UPSTREAM: 502,
      TW_UPSTREAM: 502,
      SCAN_FAILED: 500,
      TW_ABORTED: 500,
    };
    for (const [code, status] of Object.entries(table)) {
      assert.equal(statusForError({ code }), status, code);
    }
    assert.equal(statusForError(new Error('no code')), 500);
    assert.equal(statusForError(null), 500);
  });

  test('a failed first scan: the payload answers under its status, /status under 200', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: NOW });
    const getPayload = routeHandler('get', '/');
    const getStatus = routeHandler('get', '/status');

    await assert.rejects(startRefresh({ client: rejectedKeyClient() }));
    const payload = fakeRes();
    getPayload({ query: {} }, payload);
    assert.equal(payload.statusCode, 401);
    assert.equal(payload.body.status, 'error');
    assert.equal(payload.body.code, 'QAW_AUTH');

    const status = fakeRes();
    getStatus({ query: {} }, status);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, 'error');
    assert.equal(status.body.error.code, 'QAW_AUTH');
    assert.equal(status.body.refreshing, false);

    // Every workspace refused: 502 for the payload, and still 200 for /status.
    resetMaintenanceCache();
    const forbidden = fakeClient({
      failWith: (id) => new QawForbiddenError(`QA Wolf issue.find returned 403: ${id}`),
    });
    await assert.rejects(startRefresh({ client: forbidden, taskWolfClient: null }));
    const refused = fakeRes();
    getPayload({ query: {} }, refused);
    assert.equal(refused.statusCode, 502);
    assert.equal(refused.body.code, 'QAW_FORBIDDEN');

    const stillOk = fakeRes();
    getStatus({ query: {} }, stillOk);
    assert.equal(stillOk.statusCode, 200);
    assert.equal(stillOk.body.error.code, 'QAW_FORBIDDEN');
  });

  test('Task Wolf answering the handshake or tools/list with a JSON-RPC error is a 502', async (t) => {
    // The real client, over a fetch that plays Task Wolf: nothing leaves the process.
    const tripwire = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = tripwire;
      delete process.env.TASK_WOLF_MCP_TOKEN;
      delete process.env.TASK_WOLF_MCP_URL;
      resetSharedTaskWolfClient();
    });
    process.env.TASK_WOLF_MCP_TOKEN = 'tw-test-token';
    process.env.TASK_WOLF_MCP_URL = 'https://tw.test/mcp';
    const getTaskWolf = routeHandler('get', '/taskwolf');

    for (const failing of ['initialize', 'tools/list']) {
      globalThis.fetch = async (url, init) => {
        const { id, method } = JSON.parse(init.body);
        if (id === undefined) return new Response(null, { status: 202 });
        const reply =
          method === failing
            ? { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } }
            : { jsonrpc: '2.0', id, result: { serverInfo: { name: 'fake' }, tools: [] } };
        return new Response(JSON.stringify(reply), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
      resetSharedTaskWolfClient();
      const res = fakeRes();
      await getTaskWolf({ query: {} }, res);
      assert.equal(res.statusCode, 502, failing);
      assert.equal(res.body.code, 'TW_TOOL', failing);
      assert.equal(res.body.error, `Task Wolf MCP ${failing}: Internal error`, failing);
    }
  });

  test("the Task Wolf diagnostics routes are admin-only; the page's routes are not", () => {
    const route = (method, path) =>
      maintenanceRouter.stack.find((l) => l.route?.path === path && l.route.methods[method]).route;
    for (const path of ['/taskwolf', '/taskwolf/customer/:workspaceId']) {
      const gate = route('get', path).stack.at(-2).handle;
      let passed = false;
      const denied = fakeRes();
      gate({ user: { roles: ['sales_engineer_1'] } }, denied, () => {
        passed = true;
      });
      assert.equal(denied.statusCode, 403, path);
      assert.equal(passed, false, path);
      gate({ user: { roles: ['admin'] } }, fakeRes(), () => {
        passed = true;
      });
      assert.equal(passed, true, path);
    }
    // Only the session check stands in front of what the page itself calls.
    for (const [method, path] of [
      ['get', '/'],
      ['get', '/status'],
      ['post', '/refresh'],
    ]) {
      assert.equal(route(method, path).stack.length, 2, path);
    }
  });

  test('/status answers 200 with nothing cached, and starts nothing', () => {
    const res = fakeRes();
    routeHandler('get', '/status')({ query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.error.code, 'NO_SNAPSHOT');
    assert.equal(getMaintenanceStatus().refreshing, false);
  });
});
