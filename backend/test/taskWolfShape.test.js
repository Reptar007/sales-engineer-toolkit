/**
 * What Task Wolf adds to a report row and how its answers are read. The MCP's
 * schemas are read live, so the argument picker and the normalizers are
 * exercised against the shapes the server is documented to use
 * (`{ total, truncated, items }`, customer by name/slug/qawId) and against a
 * few plausible variants, so a renamed field degrades to "unknown" rather
 * than to a wrong count.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateReport,
  daysSince,
  extractItems,
  mergeTaskWolf,
  normalizeMaintenanceStatus,
  normalizeTasks,
  pickCustomerArguments,
  pickTaskArguments,
  summarizeTaskWolfCustomer,
} from '../src/projects/maintenance-dashboard/taskWolfShape.js';
import {
  buildSnapshot,
  parseExcludedSlugs,
} from '../src/projects/maintenance-dashboard/maintenanceShape.js';

const NOW = Date.parse('2026-09-28T18:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const acme = { id: 'team-acme', name: 'Acme', slug: 'acme' };

describe('pickCustomerArguments', () => {
  test('prefers an id-shaped property (qawId is the platform team id)', () => {
    const schema = {
      type: 'object',
      properties: { customer: { type: 'string' }, qawId: { type: 'string' } },
    };
    assert.deepEqual(pickCustomerArguments(schema, acme), {
      arguments: { qawId: 'team-acme' },
      via: 'qawId',
    });
  });

  test('falls back to a name/slug property, and to `customer` when no schema is published', () => {
    const schema = {
      type: 'object',
      properties: { customer: { type: 'string' }, days: { type: 'number' } },
    };
    assert.deepEqual(pickCustomerArguments(schema, acme), {
      arguments: { customer: 'acme' },
      via: 'customer',
    });
    assert.deepEqual(pickCustomerArguments({ type: 'object', properties: { query: {} } }, acme), {
      arguments: { query: 'acme' },
      via: 'query',
    });
    assert.deepEqual(pickCustomerArguments(null, acme), {
      arguments: { customer: 'acme' },
      via: 'customer',
    });
  });

  test('gives up rather than guessing when nothing in the schema looks like a customer', () => {
    assert.equal(
      pickCustomerArguments({ type: 'object', properties: { suiteId: {} } }, acme),
      null,
    );
  });
});

describe('pickTaskArguments', () => {
  test("sets the type filter in the schema's own spelling and caps the limit", () => {
    const schema = {
      type: 'object',
      properties: {
        customer: { type: 'string' },
        taskType: { type: 'string', enum: ['creation', 'test-maintenance', 'outline'] },
        limit: { type: 'number', maximum: 100 },
        includeDone: { type: 'boolean' },
      },
    };
    assert.deepEqual(pickTaskArguments(schema, acme), {
      arguments: { customer: 'acme', taskType: 'test-maintenance', limit: 100, includeDone: false },
      via: 'customer',
    });
  });

  test('an array-typed filter gets an array, and no type property means no guess', () => {
    const schema = {
      type: 'object',
      properties: { qawId: {}, types: { type: 'array', items: { enum: ['maintenance', 'bug'] } } },
    };
    assert.deepEqual(pickTaskArguments(schema, acme).arguments, {
      qawId: 'team-acme',
      types: ['maintenance'],
    });
    assert.deepEqual(
      pickTaskArguments({ type: 'object', properties: { customer: {} } }, acme).arguments,
      {
        customer: 'acme',
      },
    );
  });
});

describe('extractItems / daysSince', () => {
  test('finds the list under the documented key, a nested key, or the first array of objects', () => {
    assert.equal(extractItems({ total: 1, items: [{ a: 1 }] }).length, 1);
    assert.equal(
      extractItems({ maintenance: { flows: [{ a: 1 }, { b: 2 }] } }, ['flows']).length,
      2,
    );
    assert.equal(extractItems({ whatever: [{ a: 1 }], ids: [1, 2] }).length, 1);
    assert.equal(extractItems('prose').length, 0);
  });

  test('daysSince handles ISO, epoch and garbage', () => {
    assert.equal(daysSince(daysAgo(3), NOW), 3);
    assert.equal(daysSince(NOW - 2 * 86400000, NOW), 2);
    assert.equal(daysSince('soon', NOW), null);
    assert.equal(daysSince(undefined, NOW), null);
  });
});

describe('normalizeMaintenanceStatus', () => {
  test('reads the bounded-list shape with per-flow blockers', () => {
    const raw = {
      total: 3,
      truncated: false,
      items: [
        {
          flowId: 'f1',
          name: 'Login',
          blocked: true,
          blocker: { title: 'Staging down', owner: { name: 'Kalley' }, createdAt: daysAgo(45) },
        },
        {
          flowId: 'f2',
          name: 'Checkout',
          blocked: false,
          maintenanceSince: daysAgo(12),
          assignee: { name: 'Jordy' },
        },
        { flowId: 'f3', name: 'Search', status: 'blocked', blockedBy: 'Waiting on creds' },
      ],
    };
    const out = normalizeMaintenanceStatus(raw, NOW);
    assert.equal(out.flowsInMaintenance, 3);
    assert.equal(out.blockedFlows, 2);
    assert.equal(out.actionableFlows, 1);
    assert.equal(out.truncated, false);
    assert.deepEqual(
      out.items.map((i) => [
        i.flowId,
        i.blocked,
        i.blockerTitle,
        i.blockerOwner,
        i.ageDays,
        i.assignee,
      ]),
      [
        ['f1', true, 'Staging down', 'Kalley', null, ''],
        ['f2', false, '', '', 12, 'Jordy'],
        ['f3', true, 'Waiting on creds', '', null, ''],
      ],
    );
    assert.deepEqual(out.blockers, [
      { title: 'Staging down', owner: 'Kalley', flows: 1 },
      { title: 'Waiting on creds', owner: '', flows: 1 },
    ]);
  });

  test('explicit summary counts win over a truncated list', () => {
    const raw = {
      customer: { name: 'Acme' },
      summary: { inMaintenance: 40, blocked: 25, unblocked: 15 },
      truncated: true,
      flows: [{ flowId: 'x', blocked: true }],
    };
    const out = normalizeMaintenanceStatus(raw, NOW);
    assert.equal(out.flowsInMaintenance, 40);
    assert.equal(out.blockedFlows, 25);
    assert.equal(out.actionableFlows, 15);
    assert.equal(out.truncated, true);
    assert.equal(out.items.length, 1);
  });

  test('a JSON string is parsed; prose is unknown, not zero', () => {
    assert.equal(normalizeMaintenanceStatus('{"total":0,"items":[]}', NOW).flowsInMaintenance, 0);
    assert.equal(normalizeMaintenanceStatus('Acme has nothing in maintenance.', NOW), null);
    assert.equal(normalizeMaintenanceStatus(null, NOW), null);
  });
});

describe('normalizeTasks', () => {
  test('keeps open maintenance tasks, drops done/ignored and other types, reads people and dates', () => {
    const raw = {
      total: 5,
      items: [
        {
          id: 't1',
          title: 'Fix login',
          type: 'test-maintenance',
          status: 'in_progress',
          assignee: { name: 'Jordy' },
          dueDate: daysAgo(2),
          createdAt: daysAgo(20),
        },
        { id: 't2', title: 'Old one', type: 'test-maintenance', status: 'done', assignee: 'Nick' },
        { id: 't3', title: 'New tests', type: 'test-creation', status: 'todo' },
        {
          id: 't4',
          title: 'Blocked one',
          type: 'maintenance',
          status: 'Blocked',
          blocker: { title: 'Env down' },
        },
        { id: 't5', title: 'Ignored', type: 'maintenance', status: 'ignore' },
      ],
    };
    const out = normalizeTasks(raw, NOW);
    assert.deepEqual(
      out.tasks.map((t) => [t.id, t.assignee, t.overdue, t.blocked, t.ageDays]),
      [
        ['t1', 'Jordy', true, false, 20],
        ['t4', '', false, true, null],
      ],
    );
    assert.equal(normalizeTasks('no tasks', NOW), null);
  });
});

describe('summarizeTaskWolfCustomer / annotateReport', () => {
  const maintenance = normalizeMaintenanceStatus(
    {
      total: 3,
      items: [
        { flowId: 'f1', blocked: true, blocker: { title: 'Staging down' } },
        { flowId: 'f2', blocked: false, assignee: 'Jordy' },
        { flowId: 'f3', blocked: true, blocker: { title: 'Staging down' } },
      ],
    },
    NOW,
  );
  const tasks = normalizeTasks(
    {
      items: [
        {
          id: 't1',
          type: 'maintenance',
          status: 'open',
          assignee: 'Kalley',
          createdAt: daysAgo(9),
        },
      ],
    },
    NOW,
  );
  const customerTw = summarizeTaskWolfCustomer({ maintenance, tasks });

  test('the customer roll-up carries counts, blockers, who is on it and the blocked flow ids', () => {
    assert.equal(customerTw.flowsInMaintenance, 3);
    assert.equal(customerTw.blockedFlows, 2);
    assert.equal(customerTw.actionableFlows, 1);
    assert.deepEqual(customerTw.blockedFlowIds, ['f1', 'f3']);
    assert.deepEqual(customerTw.assignees, ['Kalley']);
    assert.deepEqual(customerTw.flowAssignees, { f2: 'Jordy' });
    assert.equal(customerTw.openTasks, 1);
    assert.equal(customerTw.oldestTaskAgeDays, 9);
  });

  test('a report is blocked only when every flow it parks is blocked', () => {
    const fully = annotateReport({ flowIds: ['f1', 'f3'], flowCount: 2 }, customerTw);
    assert.equal(fully.taskWolf.blocked, true);
    assert.equal(fully.taskWolf.blockedFlows, 2);
    assert.equal(fully.taskWolf.blockerTitle, 'Staging down');

    const partly = annotateReport({ flowIds: ['f1', 'f2'], flowCount: 2 }, customerTw);
    assert.equal(partly.taskWolf.blocked, false);
    assert.equal(partly.taskWolf.blockedFlows, 1);
    assert.deepEqual(partly.taskWolf.assignees, ['Kalley', 'Jordy']);
  });

  test('without flow ids the customer-level counts decide, and no data means unknown', () => {
    const allBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ inMaintenance: 4, blocked: 4, unblocked: 0 }, NOW),
    });
    assert.equal(
      annotateReport({ flowIds: ['z'], flowCount: 1 }, allBlocked).taskWolf.blocked,
      true,
    );
    const noneBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ inMaintenance: 4, blocked: 0 }, NOW),
    });
    assert.equal(
      annotateReport({ flowIds: ['z'], flowCount: 1 }, noneBlocked).taskWolf.blocked,
      false,
    );
    const someBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ inMaintenance: 4, blocked: 2 }, NOW),
    });
    assert.equal(
      annotateReport({ flowIds: ['z'], flowCount: 1 }, someBlocked).taskWolf.blocked,
      null,
    );
    assert.equal(annotateReport({ flowIds: ['z'], flowCount: 1 }, null).taskWolf, null);
  });
});

describe('mergeTaskWolf', () => {
  test('rows get their Task Wolf reading, totals count only confirmed data', () => {
    const globex = { id: 'team-globex', name: 'Globex', slug: 'globex' };
    const demo = {
      id: 'team-demo',
      name: 'Acme Demo',
      slug: 'acme-demo',
      organizationName: 'QA Wolf',
    };
    const report = (issueId, flowIds, createdAt) => ({
      issueId,
      number: 1,
      name: issueId,
      status: 'pending',
      createdAt,
      reproductions: flowIds.map((flowId) => ({ flowId })),
    });
    const snapshot = buildSnapshot({
      workspaces: [acme, globex, demo],
      reportsByWorkspace: new Map([
        [
          'team-acme',
          [report('a1', ['f1', 'f3'], daysAgo(100)), report('a2', ['f2'], daysAgo(50))],
        ],
        ['team-globex', [report('g1', ['g1'], daysAgo(30))]],
        ['team-demo', [report('d1', ['d1'], daysAgo(400))]],
      ]),
      excludedSlugs: parseExcludedSlugs(undefined),
      now: NOW,
    });
    const acmeTw = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        {
          total: 3,
          items: [
            { flowId: 'f1', blocked: true, blocker: 'Env' },
            { flowId: 'f3', blocked: true, blocker: 'Env' },
            { flowId: 'f2' },
          ],
        },
        NOW,
      ),
      tasks: normalizeTasks(
        { items: [{ id: 't', type: 'maintenance', status: 'open', assignee: 'Kalley' }] },
        NOW,
      ),
    });
    const merged = mergeTaskWolf(snapshot, new Map([['team-acme', acmeTw]]), {
      enabled: true,
      errors: [{ workspaceId: 'team-globex', message: 'timeout' }],
      customersQueried: 2,
    });

    assert.equal(merged.customers.find((c) => c.name === 'Acme').taskWolf.blockedFlows, 2);
    assert.equal(merged.customers.find((c) => c.name === 'Globex').taskWolf, null);
    const a1 = merged.reports.find((r) => r.issueId === 'a1');
    const a2 = merged.reports.find((r) => r.issueId === 'a2');
    const g1 = merged.reports.find((r) => r.issueId === 'g1');
    assert.equal(a1.taskWolf.blocked, true);
    assert.equal(a2.taskWolf.blocked, false);
    assert.equal(g1.taskWolf, null);
    assert.deepEqual(a2.taskWolf.assignees, ['Kalley']);

    assert.equal(merged.totals.customersWithTaskWolf, 1);
    assert.equal(merged.totals.blockedFlows, 2);
    assert.equal(merged.totals.actionableFlows, 1);
    assert.equal(merged.totals.blockedReports, 1);
    assert.equal(merged.totals.reportsWithQae, 2);
    // Platform totals are untouched.
    assert.equal(merged.totals.openReports, 3);
    assert.equal(merged.taskWolf.enabled, true);
    assert.equal(merged.taskWolf.customersAnswered, 1);
    assert.equal(merged.taskWolf.errors.length, 1);
  });
});
