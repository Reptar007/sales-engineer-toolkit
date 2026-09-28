/**
 * Ranking rules for the maintenance backlog.
 *
 * The page exists to tell an SE what to work on first, so the order of the two
 * lists is the product. These pin the rules down: what counts as a customer,
 * how old a report is, which flows still count as parked, and how ties break.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageInDays,
  activeFlowIds,
  isDemoWorkspace,
  isExcludedWorkspace,
  parseExcludedSlugs,
  shapeCustomer,
  shapeReport,
  rankCulprits,
  rankOutstanding,
  buildSnapshot,
  summarizeDescription,
} from '../src/projects/maintenance-dashboard/maintenanceShape.js';
import { unwrapTrpcResponse } from '../src/projects/maintenance-dashboard/qawolfClient.js';

const NOW = Date.parse('2026-09-28T18:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const acme = { id: 'ws-acme', name: 'Acme', slug: 'acme', organizationName: 'Acme' };
const globex = { id: 'ws-globex', name: 'Globex', slug: 'globex', organizationName: 'Globex' };
const figma = { id: 'ws-figma', name: 'Figma', slug: 'figma', organizationName: 'Figma' };
const demo = { id: 'ws-demo', name: 'Acme Demo', slug: 'acme-demo', organizationName: 'QA Wolf' };

function report(overrides = {}) {
  return {
    issueId: overrides.issueId || `issue-${Math.random().toString(36).slice(2, 8)}`,
    number: 1,
    name: 'Login changed',
    status: 'inProgress',
    priority: 'medium',
    createdAt: daysAgo(10),
    description: 'Selector moved',
    url: 'https://app.qawolf.com/acme/maintenance-reports/x',
    reproductions: [{ flowId: 'flow-1', isActive: true }],
    ...overrides,
  };
}

describe('ageInDays', () => {
  test('counts whole days and never goes negative', () => {
    assert.equal(ageInDays(daysAgo(10), NOW), 10);
    assert.equal(ageInDays(daysAgo(0.4), NOW), 0);
    assert.equal(ageInDays(new Date(NOW + 60_000).toISOString(), NOW), 0);
  });

  test('treats an unparseable timestamp as zero rather than throwing', () => {
    assert.equal(ageInDays(undefined, NOW), 0);
    assert.equal(ageInDays('not a date', NOW), 0);
  });
});

describe('activeFlowIds', () => {
  test('keeps active reproductions, drops healed ones, dedupes', () => {
    const ids = activeFlowIds(
      report({
        reproductions: [
          { flowId: 'a', isActive: true },
          { flowId: 'a', isActive: true },
          { flowId: 'b', isActive: false },
          { flowId: 'c' },
        ],
      }),
    );
    assert.deepEqual([...ids].sort(), ['a', 'c']);
  });
});

describe('workspace filters', () => {
  test('figma is excluded by default, by slug or by name, case-insensitively', () => {
    const excluded = parseExcludedSlugs(undefined);
    assert.equal(isExcludedWorkspace(figma, excluded), true);
    assert.equal(isExcludedWorkspace({ ...figma, slug: 'FIGMA' }, excluded), true);
    assert.equal(isExcludedWorkspace(acme, excluded), false);
  });

  test('the env list replaces the default and tolerates spaces', () => {
    const excluded = parseExcludedSlugs(' acme , globex ');
    assert.equal(isExcludedWorkspace(figma, excluded), false);
    assert.equal(isExcludedWorkspace(acme, excluded), true);
    assert.equal(isExcludedWorkspace(globex, excluded), true);
  });

  test('demo and sandbox workspaces are flagged, customers are not', () => {
    assert.equal(isDemoWorkspace(demo), true);
    assert.equal(isDemoWorkspace({ name: "Becca's Sandbox", organizationName: 'x' }), true);
    assert.equal(
      isDemoWorkspace({ name: 'Teamworks Demo Sandbox', organizationName: 'QA Wolf' }),
      true,
    );
    assert.equal(
      isDemoWorkspace({ name: 'Contest Corp', organizationName: 'Contest Corp' }),
      false,
    );
    assert.equal(isDemoWorkspace(acme), false);
  });
});

describe('shapeReport / shapeCustomer', () => {
  test('a report row carries age, live flow count, healed count and workspace facts', () => {
    const row = shapeReport(
      report({
        number: 41,
        createdAt: daysAgo(231),
        reproductions: [
          { flowId: 'a', isActive: true },
          { flowId: 'b', isActive: false },
        ],
      }),
      acme,
      NOW,
    );
    assert.equal(row.ageDays, 231);
    assert.equal(row.flowCount, 1);
    assert.equal(row.healedFlowCount, 1);
    assert.equal(row.number, 41);
    assert.equal(row.workspaceName, 'Acme');
    assert.equal(row.workspaceSlug, 'acme');
    assert.equal(row.isDemo, false);
    assert.equal(row.priorityRank, 2);
  });

  test('a customer counts distinct flows across its reports', () => {
    const customer = shapeCustomer(
      acme,
      [
        report({ createdAt: daysAgo(100), reproductions: [{ flowId: 'a' }, { flowId: 'b' }] }),
        report({ createdAt: daysAgo(5), reproductions: [{ flowId: 'b' }, { flowId: 'c' }] }),
      ],
      NOW,
    );
    assert.equal(customer.openReports, 2);
    assert.equal(customer.flowsInMaintenance, 3);
    assert.equal(customer.oldestReportAgeDays, 100);
    assert.equal(customer.averageReportAgeDays, 53);
    assert.equal(customer.url, 'https://app.qawolf.com/acme/maintenance-reports');
  });
});

describe('ranking', () => {
  test('culprits: most parked flows first, then reports, then age', () => {
    const rows = [
      { name: 'B', flowsInMaintenance: 5, openReports: 1, oldestReportAgeDays: 10 },
      { name: 'A', flowsInMaintenance: 5, openReports: 2, oldestReportAgeDays: 3 },
      { name: 'C', flowsInMaintenance: 9, openReports: 1, oldestReportAgeDays: 1 },
      { name: 'D', flowsInMaintenance: 5, openReports: 1, oldestReportAgeDays: 40 },
    ];
    assert.deepEqual(
      rankCulprits(rows).map((r) => r.name),
      ['C', 'A', 'D', 'B'],
    );
  });

  test('outstanding: oldest first, then flows, then priority', () => {
    const rows = [
      { name: 'p', ageDays: 30, flowCount: 1, priorityRank: 2, workspaceName: 'x' },
      { name: 'q', ageDays: 90, flowCount: 1, priorityRank: 3, workspaceName: 'x' },
      { name: 'r', ageDays: 90, flowCount: 4, priorityRank: 3, workspaceName: 'x' },
      { name: 's', ageDays: 90, flowCount: 4, priorityRank: 0, workspaceName: 'x' },
    ];
    assert.deepEqual(
      rankOutstanding(rows).map((r) => r.name),
      ['s', 'r', 'q', 'p'],
    );
  });
});

describe('buildSnapshot', () => {
  test('excludes figma, flags demos, skips clean workspaces, totals the rest', () => {
    const reportsByWorkspace = new Map([
      ['ws-acme', [report({ createdAt: daysAgo(200), reproductions: [{ flowId: 'a' }] })]],
      [
        'ws-globex',
        [
          report({
            createdAt: daysAgo(20),
            reproductions: [{ flowId: 'g1' }, { flowId: 'g2' }, { flowId: 'g3' }],
          }),
          report({ createdAt: daysAgo(2), status: 'resolved', reproductions: [{ flowId: 'g9' }] }),
        ],
      ],
      ['ws-figma', [report({ createdAt: daysAgo(900), reproductions: [{ flowId: 'f' }] })]],
      ['ws-demo', [report({ createdAt: daysAgo(400), reproductions: [{ flowId: 'd' }] })]],
      ['ws-clean', []],
    ]);
    const snapshot = buildSnapshot({
      workspaces: [acme, globex, figma, demo, { id: 'ws-clean', name: 'Clean', slug: 'clean' }],
      reportsByWorkspace,
      excludedSlugs: parseExcludedSlugs(undefined),
      errors: [{ workspaceId: 'ws-broken', message: 'boom' }],
      now: NOW,
    });

    assert.equal(snapshot.totals.workspacesScanned, 5);
    assert.equal(snapshot.totals.workspacesExcluded, 1);
    assert.equal(snapshot.totals.workspacesFailed, 1);
    // Demo backlog is kept in the rows (flagged) but out of the headline totals.
    assert.equal(snapshot.totals.customersWithBacklog, 2);
    assert.equal(snapshot.totals.demoWorkspacesWithBacklog, 1);
    assert.equal(snapshot.totals.openReports, 2);
    assert.equal(snapshot.totals.flowsInMaintenance, 4);
    assert.equal(snapshot.totals.oldestReportAgeDays, 200);

    // Acme and Acme Demo tie on flows and reports, so the older backlog wins.
    assert.deepEqual(
      snapshot.customers.map((c) => c.name),
      ['Globex', 'Acme Demo', 'Acme'],
    );
    assert.equal(snapshot.customers.find((c) => c.name === 'Acme Demo').isDemo, true);
    assert.equal(
      snapshot.customers.some((c) => c.name === 'Figma'),
      false,
    );
    // The resolved Globex report is not open, so it is not a row.
    assert.equal(snapshot.reports.length, 3);
    assert.equal(snapshot.reports[0].workspaceName, 'Acme Demo');
    assert.equal(snapshot.reports[1].workspaceName, 'Acme');
  });
});

describe('summarizeDescription', () => {
  test('collapses whitespace and truncates with an ellipsis', () => {
    assert.equal(summarizeDescription('  a\n\nb   c '), 'a b c');
    const long = 'x'.repeat(200);
    const out = summarizeDescription(long, 50);
    assert.equal(out.length, 50);
    assert.ok(out.endsWith('…'));
    assert.equal(summarizeDescription(null), '');
  });
});

describe('unwrapTrpcResponse', () => {
  test('unwraps superjson and plain envelopes, passes anything else through', () => {
    assert.deepEqual(unwrapTrpcResponse({ result: { data: { json: { a: 1 }, meta: {} } } }), {
      a: 1,
    });
    assert.deepEqual(unwrapTrpcResponse({ result: { data: { a: 1 } } }), { a: 1 });
    assert.deepEqual(unwrapTrpcResponse({ result: { data: { json: 1, other: 2 } } }), {
      json: 1,
      other: 2,
    });
    assert.deepEqual(unwrapTrpcResponse({ a: 1 }), { a: 1 });
  });
});
