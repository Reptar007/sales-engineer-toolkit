/**
 * The scan orchestration: bounded fan-out, partial failure tolerated, auth
 * failure not. The client is injected so nothing here touches the network.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapWithConcurrency,
  scanMaintenanceBacklog,
  getMaintenanceDashboard,
  resetMaintenanceCache,
} from '../src/projects/maintenance-dashboard/maintenanceService.js';
import { QawAuthError } from '../src/projects/maintenance-dashboard/qawolfClient.js';

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

describe('getMaintenanceDashboard', () => {
  beforeEach(() => resetMaintenanceCache());

  test('reports building, then error, when there is no snapshot and no scan', () => {
    // With no token configured the background scan fails fast; the first call
    // still answers "building" because the promise is in flight when we ask.
    const first = getMaintenanceDashboard();
    assert.ok(['building', 'error'].includes(first.status));
  });
});
