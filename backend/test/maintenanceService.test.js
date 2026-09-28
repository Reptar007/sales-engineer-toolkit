/**
 * The scan orchestration: bounded fan-out, partial failure tolerated, auth
 * failure not. The client is injected so nothing here touches the network.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichWithTaskWolf,
  mapWithConcurrency,
  probeTaskWolfCustomer,
  scanMaintenanceBacklog,
  getMaintenanceDashboard,
  resetMaintenanceCache,
} from '../src/projects/maintenance-dashboard/maintenanceService.js';
import { QawAuthError } from '../src/projects/maintenance-dashboard/qawolfClient.js';
import { TaskWolfAuthError } from '../src/projects/maintenance-dashboard/taskWolfMcpClient.js';

const NOW = Date.parse('2026-09-28T18:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const workspaces = [
  { id: 'ws-1', name: 'One', slug: 'one', organizationName: 'One' },
  { id: 'ws-2', name: 'Two', slug: 'two', organizationName: 'Two' },
  { id: 'ws-3', name: 'Three', slug: 'three', organizationName: 'Three' },
  { id: 'ws-figma', name: 'Figma', slug: 'figma', organizationName: 'Figma' },
];

function fakeClient({ failing = new Set(), authFail = false } = {}) {
  const calls = [];
  return {
    calls,
    listWorkspaces: async () => workspaces,
    listOpenMaintenanceReports: async (workspaceId) => {
      calls.push(workspaceId);
      if (authFail) throw new QawAuthError();
      if (failing.has(workspaceId)) throw new Error(`${workspaceId} exploded`);
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
  test('scans every workspace, skips the excluded one from the rows, reports progress', async () => {
    const client = fakeClient();
    const progress = [];
    const snapshot = await scanMaintenanceBacklog({
      client,
      concurrency: 2,
      onProgress: (p) => progress.push(p),
      now: () => NOW,
    });
    assert.equal(client.calls.length, 4);
    assert.equal(snapshot.totals.workspacesScanned, 4);
    assert.equal(snapshot.totals.workspacesExcluded, 1);
    assert.equal(snapshot.customers.length, 1);
    assert.equal(snapshot.customers[0].name, 'Two');
    assert.equal(snapshot.customers[0].flowsInMaintenance, 2);
    assert.equal(snapshot.reports[0].ageDays, 45);
    assert.equal(progress.at(-1).scanned, 4);
    assert.equal(progress.at(-1).total, 4);
  });

  test('a workspace that errors is listed, not silently dropped', async () => {
    const client = fakeClient({ failing: new Set(['ws-3']) });
    const snapshot = await scanMaintenanceBacklog({ client, concurrency: 4, now: () => NOW });
    assert.equal(snapshot.totals.workspacesFailed, 1);
    assert.equal(snapshot.errors[0].workspaceId, 'ws-3');
    assert.match(snapshot.errors[0].message, /exploded/);
    assert.equal(snapshot.customers.length, 1);
  });

  test('an auth failure fails the whole scan', async () => {
    const client = fakeClient({ authFail: true });
    await assert.rejects(
      scanMaintenanceBacklog({ client, concurrency: 2, now: () => NOW }),
      (error) => error.code === 'QAW_AUTH',
    );
  });
});

/**
 * A fake Task Wolf MCP: offers the two tools with a `customer` argument and
 * answers per customer slug. `failing` slugs throw; `authFailAfter` turns the
 * token stale after that many calls.
 */
function fakeTaskWolf({ failing = new Set(), authFailAfter = Infinity, tools } = {}) {
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
      if (calls.length > authFailAfter) throw new TaskWolfAuthError();
      if (failing.has(args.customer)) throw new Error(`${name} timed out for ${args.customer}`);
      if (name === 'get_maintenance_status') {
        if (args.customer === 'two') {
          return {
            total: 2,
            truncated: false,
            items: [
              { flowId: 'f1', name: 'Checkout', blocked: true, blocker: { title: 'Staging down' } },
              { flowId: 'f2', name: 'Search', blocked: false },
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

describe('getMaintenanceDashboard', () => {
  beforeEach(() => resetMaintenanceCache());

  test('reports building, then error, when there is no snapshot and no scan', () => {
    // With no token configured the background scan fails fast; the first call
    // still answers "building" because the promise is in flight when we ask.
    const first = getMaintenanceDashboard();
    assert.ok(['building', 'error'].includes(first.status));
  });
});
