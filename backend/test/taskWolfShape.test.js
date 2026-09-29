/**
 * What Task Wolf adds to a report row and how its answers are read. The MCP's
 * schemas are read live, so the argument picker and the normalizers are
 * exercised against the shapes the server is documented to use
 * (`{ total, truncated, items }`, customer by name/slug/qawId) and against a
 * few plausible variants, so a renamed field degrades to "unknown" rather
 * than to a wrong count. The real server answers `get_maintenance_status` by
 * report (one entry per open report, its flows under it, the customer's flow
 * counts in a summary); those fixtures are invented in that shape.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateReport,
  daysSince,
  extractItems,
  isCustomerNotFound,
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
import { parseToolResult } from '../src/projects/maintenance-dashboard/taskWolfMcpClient.js';

const NOW = Date.parse('2026-09-28T18:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const acme = { id: 'team-acme', name: 'Acme', slug: 'acme' };

// `get_maintenance_status` as Task Wolf answers it: one entry per open report.
const issueAnswer = ({ summary = {}, items }) => ({
  customer: {
    qawId: 'team-acme',
    officialName: 'Acme Corporation',
    shortName: 'Acme',
    slug: 'acme',
    qaTeam: { id: 7, name: 'Otters' },
  },
  summary: { openMaintenanceIssues: items.length, truncated: false, ...summary },
  items,
});
const issue = (number, flowIds, fields = {}) => ({
  issueId: `iss_${number}`,
  number,
  name: `Report ${number}`,
  issueStatus: 'inProgress',
  createdAt: daysAgo(10),
  ageDays: 10,
  blocked: false,
  blocker: null,
  taskStatusCounts: { inProgress: flowIds.length },
  assignees: [],
  flows: flowIds.map((workflowId) => ({ workflowId, name: `Flow ${workflowId}` })),
  link: `https://qa.example.test/acme/maintenance-reports/${number}`,
  ...fields,
});
const SSO = 'Staging SSO certificate expired';
// A blocked report and a free one, three flows between them.
const twoReports = issueAnswer({
  summary: {
    blockedIssues: 1,
    notBlockedIssues: 1,
    flowsInMaintenance: 3,
    flowsBlocked: 2,
    flowsNotBlocked: 1,
  },
  items: [
    issue(201, ['wf-a', 'wf-b'], {
      blocked: true,
      blocker: { title: SSO, description: 'Every login bounces off the identity provider.' },
      assignees: ['Rowan Pike', 'Ines Calder'],
      taskStatusCounts: { blocked: 2, done: 4 },
    }),
    issue(202, ['wf-c'], { assignees: ['Tomas Wren'] }),
  ],
});

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

  test('asks for the longest list the schema allows, so answers are cut short less often', () => {
    const schema = {
      type: 'object',
      properties: { qawId: { type: 'string' }, limit: { type: 'number', maximum: 500 } },
    };
    assert.deepEqual(pickCustomerArguments(schema, acme), {
      arguments: { qawId: 'team-acme', limit: 200 },
      via: 'qawId',
    });
    assert.deepEqual(
      pickCustomerArguments(
        { type: 'object', properties: { customer: {}, pageSize: { maximum: 50 } } },
        acme,
      ).arguments,
      { customer: 'acme', pageSize: 50 },
    );
  });

  test('qawId comes first, in either spelling, whatever else the schema declares', () => {
    const schema = {
      type: 'object',
      properties: { teamId: {}, customer: {}, customerId: {}, qawId: {} },
    };
    assert.deepEqual(pickCustomerArguments(schema, acme), {
      arguments: { qawId: 'team-acme' },
      via: 'qawId',
    });
    assert.deepEqual(
      pickCustomerArguments({ type: 'object', properties: { customer: {}, qaw_id: {} } }, acme),
      { arguments: { qaw_id: 'team-acme' }, via: 'qaw_id' },
    );
  });

  test('the documented `customer` beats any other id: `teamId` may be a QAE team filter', () => {
    for (const idName of ['teamId', 'team_id', 'workspaceId', 'customerId', 'customer_id']) {
      const schema = { type: 'object', properties: { [idName]: {}, customer: {} } };
      assert.deepEqual(
        pickCustomerArguments(schema, acme),
        { arguments: { customer: 'acme' }, via: 'customer' },
        idName,
      );
    }
    assert.deepEqual(
      pickCustomerArguments({ type: 'object', properties: { teamId: {}, slug: {} } }, acme),
      { arguments: { slug: 'acme' }, via: 'slug' },
    );
  });

  test('a name-shaped property is filled with the slug, then the name, then the id', () => {
    const schema = { type: 'object', properties: { customerName: {}, teamId: {} } };
    assert.deepEqual(pickCustomerArguments(schema, { id: 'team-acme', name: 'Acme' }).arguments, {
      customerName: 'Acme',
    });
    assert.deepEqual(pickCustomerArguments(schema, { id: 'team-acme' }).arguments, {
      customerName: 'team-acme',
    });
    // No id to give: qawId is passed over for the name-shaped property.
    assert.deepEqual(
      pickCustomerArguments(
        { type: 'object', properties: { qawId: {}, customer: {} } },
        { slug: 'acme', name: 'Acme' },
      ),
      { arguments: { customer: 'acme' }, via: 'customer' },
    );
  });

  test('a name property that also takes a qawId gets the workspace id, which matches exactly', () => {
    const schema = {
      type: 'object',
      properties: { customer: { type: 'string', description: 'Customer name, slug, or qawId' } },
      required: ['customer'],
    };
    assert.deepEqual(pickCustomerArguments(schema, acme), {
      arguments: { customer: 'team-acme' },
      via: 'customer',
    });
    assert.deepEqual(
      pickCustomerArguments(
        { type: 'object', properties: { customer: { description: 'Name or QAWID' } } },
        acme,
      ).arguments,
      { customer: 'team-acme' },
    );
    // No id to give, or a description that does not offer it: the slug, as before.
    assert.deepEqual(pickCustomerArguments(schema, { slug: 'acme', name: 'Acme' }).arguments, {
      customer: 'acme',
    });
    assert.deepEqual(
      pickCustomerArguments(
        { type: 'object', properties: { customer: { description: 'Customer name or slug' } } },
        acme,
      ).arguments,
      { customer: 'acme' },
    );
  });

  test('a free-text filter ranks after every id, and is never filled just because it is required', () => {
    for (const [text, id] of [
      ['query', 'customerId'],
      ['search', 'workspaceId'],
      ['name', 'teamId'],
      ['team', 'team_id'],
    ]) {
      assert.deepEqual(
        pickCustomerArguments({ type: 'object', properties: { [text]: {}, [id]: {} } }, acme),
        { arguments: { [id]: 'team-acme' }, via: id },
        text,
      );
    }
    // Beside the customer, a text filter would only narrow the task list.
    assert.deepEqual(
      pickCustomerArguments(
        {
          type: 'object',
          properties: { customer: {}, query: {} },
          required: ['customer', 'query'],
        },
        acme,
      ),
      { arguments: { customer: 'acme' }, via: 'customer' },
    );
    // With no id to give, the text filter is still better than nothing.
    assert.deepEqual(
      pickCustomerArguments(
        { type: 'object', properties: { search: {}, teamId: {} } },
        { slug: 'acme' },
      ),
      { arguments: { search: 'acme' }, via: 'search' },
    );
  });

  test('the other id-shaped names are used only when no customer name property is offered', () => {
    assert.deepEqual(pickCustomerArguments({ type: 'object', properties: { teamId: {} } }, acme), {
      arguments: { teamId: 'team-acme' },
      via: 'teamId',
    });
    assert.deepEqual(
      pickCustomerArguments(
        { type: 'object', properties: { customer_id: {}, limit: { maximum: 50 } } },
        acme,
      ),
      { arguments: { customer_id: 'team-acme', limit: 50 }, via: 'customer_id' },
    );
    assert.equal(
      pickCustomerArguments({ type: 'object', properties: { teamId: {} } }, { slug: 'acme' }),
      null,
    );
  });

  test('required customer-shaped properties the pick left empty are filled too', () => {
    assert.deepEqual(
      pickCustomerArguments(
        {
          type: 'object',
          properties: { customer: {}, qawId: {}, status: {} },
          required: ['customer', 'qawId', 'status'],
        },
        acme,
      ),
      { arguments: { qawId: 'team-acme', customer: 'acme' }, via: 'qawId' },
    );
    assert.deepEqual(
      pickCustomerArguments(
        {
          type: 'object',
          properties: { customer: {}, teamId: {}, limit: {} },
          required: ['teamId', 'customer'],
        },
        acme,
      ),
      { arguments: { customer: 'acme', teamId: 'team-acme', limit: 200 }, via: 'customer' },
    );
    // Not required, not sent; and an id nobody has is not made up.
    assert.deepEqual(
      pickCustomerArguments(
        { type: 'object', properties: { customer: {}, teamId: {} }, required: ['customer'] },
        acme,
      ).arguments,
      { customer: 'acme' },
    );
    assert.deepEqual(
      pickCustomerArguments(
        {
          type: 'object',
          properties: { customer: {}, teamId: {} },
          required: ['customer', 'teamId'],
        },
        { slug: 'acme' },
      ).arguments,
      { customer: 'acme' },
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

  test('a type enum with no maintenance-like member gets no guessed value', () => {
    const schema = {
      type: 'object',
      properties: {
        customer: { type: 'string' },
        type: { type: 'string', enum: ['bug', 'creation', 'outline'] },
        includeDone: { type: 'boolean' },
      },
    };
    assert.deepEqual(pickTaskArguments(schema, acme), {
      arguments: { customer: 'acme', includeDone: false },
      via: 'customer',
    });
    assert.deepEqual(
      pickTaskArguments(
        {
          type: 'object',
          properties: { customer: {}, types: { type: 'array', items: { enum: ['bug'] } } },
        },
        acme,
      ).arguments,
      { customer: 'acme' },
    );
  });

  test('a type property with no enum at all is still asked for maintenance', () => {
    assert.deepEqual(
      pickTaskArguments(
        { type: 'object', properties: { customer: {}, type: { type: 'string' } } },
        acme,
      ).arguments,
      { customer: 'acme', type: 'maintenance' },
    );
  });

  test('find_tasks as Task Wolf declares it: the customer by workspace id, its maintenance type', () => {
    const schema = {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Customer name, slug, or qawId' },
        team: { type: 'string', description: 'QA team name or numeric team id' },
        assignee: { type: 'string' },
        unassigned: { type: 'boolean' },
        statuses: {
          type: 'array',
          items: { type: 'string', enum: ['blocked', 'done', 'inProgress', 'toDo', 'scheduled'] },
        },
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['testCreation', 'testMaintenance', 'maintenanceReport', 'softMaintenance'],
          },
        },
        overdue: { type: 'boolean' },
      },
    };
    assert.deepEqual(pickTaskArguments(schema, acme), {
      arguments: { customer: 'team-acme', types: ['testMaintenance'] },
      via: 'customer',
    });
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

  test('an array under an error-ish key is never the list, at any depth', () => {
    assert.deepEqual(extractItems({ errors: [{ message: 'customer not found' }] }), []);
    assert.deepEqual(extractItems({ error: 'x', details: [{ field: 'customer' }] }), []);
    assert.deepEqual(extractItems({ error: { Messages: [{ text: 'bad' }] } }), []);
    assert.deepEqual(extractItems({ data: { problems: [{ flowId: 'f1' }] } }), []);
    // Beside a real list, the list is found and the warnings left alone.
    assert.deepEqual(extractItems({ warnings: [{ code: 'slow' }], whatever: [{ id: 't1' }] }), [
      { id: 't1' },
    ]);
  });

  test('daysSince handles ISO, epoch and garbage', () => {
    assert.equal(daysSince(daysAgo(3), NOW), 3);
    assert.equal(daysSince(NOW - 2 * 86400000, NOW), 2);
    assert.equal(daysSince('soon', NOW), null);
    assert.equal(daysSince(undefined, NOW), null);
  });

  test('daysSince reads an epoch in seconds, in milliseconds and an ISO string alike', () => {
    const ms = NOW - 3 * 86400000;
    assert.equal(daysSince(Math.floor(ms / 1000), NOW), 3);
    assert.equal(daysSince(ms, NOW), 3);
    assert.equal(daysSince(new Date(ms).toISOString(), NOW), 3);
    // A moment still to come is zero days old, whichever unit it came in.
    assert.equal(daysSince(Math.floor((NOW + 5 * 86400000) / 1000), NOW), 0);
    assert.equal(daysSince(NOW + 5 * 86400000, NOW), 0);
  });

  test('daysSince draws the line between seconds and milliseconds at 1e11', () => {
    // 1e11 - 1 seconds is the year 5138; 1e11 milliseconds is March 1973.
    const farOff = 1e11 * 1000 + 2 * 86400000;
    assert.equal(daysSince(1e11 - 1, farOff), 2);
    assert.equal(daysSince(1e11, NOW), Math.floor((NOW - 1e11) / 86400000));
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

  test('JSON with no recognised count and no items is unknown, not zero', () => {
    assert.equal(normalizeMaintenanceStatus({ message: 'No customer matched' }, NOW), null);
    assert.equal(normalizeMaintenanceStatus({ items: [] }, NOW), null);
    assert.equal(normalizeMaintenanceStatus([], NOW), null);
  });

  test('counts stated with no list are not a list of nothing: a count nobody gave stays null', () => {
    const read = (raw) => {
      const out = normalizeMaintenanceStatus(raw, NOW);
      return [out.flowsInMaintenance, out.blockedFlows, out.actionableFlows];
    };
    // Both counts given: the pile is their sum.
    assert.deepEqual(read({ blocked: 0, actionable: 5 }), [5, 0, 5]);
    assert.deepEqual(read({ blocked: 4, actionable: 0 }), [4, 4, 0]);
    // One count given: the other is not worked out from a total of zero.
    assert.deepEqual(read({ blocked: 2 }), [null, 2, null]);
    assert.deepEqual(read({ actionable: 3 }), [null, null, 3]);
    // A stated total still decides the other count.
    assert.deepEqual(read({ inMaintenance: 4, blocked: 1 }), [4, 1, 3]);
    assert.deepEqual(read({ total: 0 }), [0, 0, 0]);
  });

  test('a list cut short only puts floors under the counts; nothing is derived from the total', () => {
    const tenBlocked = Array.from({ length: 10 }, (_, i) => ({ id: `mnt_${i}`, blocked: true }));
    const out = normalizeMaintenanceStatus({ total: 40, truncated: true, items: tenBlocked }, NOW);
    assert.equal(out.flowsInMaintenance, 40);
    assert.equal(out.blockedFlows, 10);
    assert.equal(out.actionableFlows, null); // not 30: the other 30 could be either
    assert.equal(out.partial, true);

    // A listed free flow is a floor too, and a floor of zero is no answer.
    const oneFree = normalizeMaintenanceStatus(
      { total: 40, truncated: true, items: [{ id: 'mnt_1', blocked: false }] },
      NOW,
    );
    assert.equal(oneFree.blockedFlows, null);
    assert.equal(oneFree.actionableFlows, 1);
    assert.equal(oneFree.partial, true);

    // Fewer items than the stated total is cut short too, flag or no flag.
    const unflagged = normalizeMaintenanceStatus({ total: 40, items: tenBlocked }, NOW);
    assert.equal(unflagged.actionableFlows, null);
    assert.equal(unflagged.partial, true);

    // Cut short with no total at all: even the size of the pile is unknown.
    const noTotal = normalizeMaintenanceStatus({ truncated: true, items: tenBlocked }, NOW);
    assert.equal(noTotal.flowsInMaintenance, null);
    assert.equal(noTotal.actionableFlows, null);
    assert.equal(noTotal.partial, true);
  });

  test('a bounded list nested one level down is cut short by its own flag or total', () => {
    const tenBlocked = Array.from({ length: 10 }, (_, i) => ({ id: `mnt_${i}`, blocked: true }));
    for (const raw of [
      { data: { total: 40, truncated: true, items: tenBlocked } },
      { data: { total: 40, items: tenBlocked } },
      { result: { items: tenBlocked, hasMore: true } },
      { result: { items: tenBlocked, has_more: true } },
      { customer: { name: 'Acme' }, maintenance: { flows: tenBlocked, hasMore: 1 } },
    ]) {
      const out = normalizeMaintenanceStatus(raw, NOW);
      const label = JSON.stringify(raw).slice(0, 60);
      assert.equal(out.partial, true, label);
      assert.equal(out.blockedFlows, 10, label);
      assert.equal(out.actionableFlows, null, label);
      // So a report whose flows are not on the list stays unknown, not Blocked.
      const customer = summarizeTaskWolfCustomer({ maintenance: out });
      assert.equal(customer.truncated, true, label);
      const report = annotateReport({ flowIds: ['pf-1'], flowCount: 1 }, customer);
      assert.equal(report.taskWolf.blocked, null, label);
    }
    assert.equal(
      normalizeMaintenanceStatus({ data: { total: 40, items: tenBlocked } }, NOW)
        .flowsInMaintenance,
      40,
    );
    // The server's own flag is passed on from where it sat.
    assert.equal(
      normalizeMaintenanceStatus({ result: { items: tenBlocked, hasMore: true } }, NOW).truncated,
      true,
    );

    // A whole nested list is still counted as it stands.
    const whole = normalizeMaintenanceStatus(
      {
        result: {
          total: 2,
          hasMore: false,
          items: [{ id: 'mnt_1', blocked: true }, { id: 'mnt_2' }],
        },
      },
      NOW,
    );
    assert.equal(whole.partial, false);
    assert.equal(whole.flowsInMaintenance, 2);
    assert.equal(whole.blockedFlows, 1);
    assert.equal(whole.actionableFlows, 1);
  });

  test('error JSON carrying arrays of objects is no answer, not a list of flows', () => {
    for (const raw of [
      { errors: [{ message: 'customer not found' }] },
      { error: 'x', details: [{ field: 'customer' }] },
      { message: 'No customer matched', warnings: [{ flowId: 'f1', blocked: true }] },
      { error: { messages: [{ text: 'bad' }] } },
    ]) {
      assert.equal(normalizeMaintenanceStatus(raw, NOW), null, JSON.stringify(raw));
    }
    // Warnings beside a real list do not change what the list says.
    const out = normalizeMaintenanceStatus(
      { total: 1, items: [{ flowId: 'f1' }], warnings: [{ flowId: 'f9', blocked: true }] },
      NOW,
    );
    assert.deepEqual(
      out.items.map((i) => i.flowId),
      ['f1'],
    );
    assert.equal(out.blockedFlows, 0);
  });

  test('a stated count makes a short list exact again; a whole list is counted as it stands', () => {
    const stated = normalizeMaintenanceStatus(
      { total: 40, blocked: 12, truncated: true, items: [{ id: 'mnt_1', blocked: true }] },
      NOW,
    );
    assert.equal(stated.blockedFlows, 12);
    assert.equal(stated.actionableFlows, 28);
    assert.equal(stated.partial, false);

    const whole = normalizeMaintenanceStatus(
      { total: 2, truncated: false, items: [{ id: 'mnt_1', blocked: true }, { id: 'mnt_2' }] },
      NOW,
    );
    assert.equal(whole.blockedFlows, 1);
    assert.equal(whole.actionableFlows, 1);
    assert.equal(whole.partial, false);
  });

  test('blocked is read from the flag (0/1 too), an active blocker, or a status that says so', () => {
    const blockedOf = (item) =>
      normalizeMaintenanceStatus({ items: [{ flowId: 'f', ...item }] }, NOW).items[0].blocked;

    // The status has to say "blocked" as a word of its own, and not negated.
    assert.equal(blockedOf({ status: 'blocked' }), true);
    assert.equal(blockedOf({ status: 'Blocked_on_customer' }), true);
    assert.equal(blockedOf({ status: 'customerBlocked' }), true);
    assert.equal(blockedOf({ status: 'unblocked' }), false);
    assert.equal(blockedOf({ status: 'not_blocked' }), false);
    assert.equal(blockedOf({ status: 'notBlocked' }), false);

    // A numeric flag is a flag, and a flag beats the status.
    assert.equal(blockedOf({ blocked: 0, status: 'blocked' }), false);
    assert.equal(blockedOf({ blocked: 1, status: 'in_progress' }), true);
    assert.equal(blockedOf({ isBlocked: '0' }), false);

    // An empty or resolved blocker is not a blocker.
    assert.equal(blockedOf({ blocker: {} }), false);
    assert.equal(blockedOf({ blocker: { title: '', owner: null } }), false);
    assert.equal(blockedOf({ blocker: { title: 'Staging down', resolved: true } }), false);
    assert.equal(blockedOf({ blocker: { title: 'Creds', resolvedAt: daysAgo(2) } }), false);
    assert.equal(blockedOf({ blocker: { title: 'Creds', status: 'resolved' } }), false);
    assert.equal(blockedOf({ blockers: [] }), false);
    assert.equal(blockedOf({ blocker: { title: 'Staging down' } }), true);
  });

  test('the first blocker still in the way is the one named', () => {
    const out = normalizeMaintenanceStatus(
      {
        items: [
          {
            flowId: 'f1',
            blockers: [{ title: 'Old creds', status: 'done' }, { title: 'Staging down' }],
          },
          { flowId: 'f2', blockers: [{ title: 'Old creds', resolved: true }] },
        ],
      },
      NOW,
    );
    assert.deepEqual(
      out.items.map((i) => [i.flowId, i.blocked, i.blockerTitle]),
      [
        ['f1', true, 'Staging down'],
        ['f2', false, ''],
      ],
    );
    assert.deepEqual(out.blockers, [{ title: 'Staging down', owner: '', flows: 1 }]);
    assert.equal(out.blockedFlows, 1);
    assert.equal(out.actionableFlows, 1);
  });

  test('reads an answer by report: each report with its verdict, blocker, QAEs and flows', () => {
    const out = normalizeMaintenanceStatus(twoReports, NOW);
    assert.deepEqual([out.flowsInMaintenance, out.blockedFlows, out.actionableFlows], [3, 2, 1]);
    assert.equal(out.truncated, false);
    assert.equal(out.partial, false);
    assert.deepEqual(
      out.issues.map((i) => [
        i.issueId,
        i.number,
        i.blocked,
        i.blockerTitle,
        i.assignees,
        i.flowIds,
      ]),
      [
        ['iss_201', 201, true, SSO, ['Rowan Pike', 'Ines Calder'], ['wf-a', 'wf-b']],
        ['iss_202', 202, false, '', ['Tomas Wren'], ['wf-c']],
      ],
    );
    // Its flows are flow entries carrying their report's verdict.
    assert.deepEqual(
      out.items.map((i) => [i.flowId, i.blocked, i.blockerTitle]),
      [
        ['wf-a', true, SSO],
        ['wf-b', true, SSO],
        ['wf-c', false, ''],
      ],
    );
    // The blocker holds up every flow of the report it is on.
    assert.deepEqual(out.blockers, [{ title: SSO, owner: '', flows: 2 }]);
    // The flow-shaped reading has no reports.
    assert.equal(
      normalizeMaintenanceStatus({ total: 1, items: [{ flowId: 'f1' }] }, NOW).issues,
      null,
    );
  });

  test("by report, the flow counts are the summary's, never the number of reports listed", () => {
    const counts = (raw) => {
      const out = normalizeMaintenanceStatus(raw, NOW);
      return [out.flowsInMaintenance, out.blockedFlows, out.actionableFlows, out.partial];
    };
    const three = [issue(1, ['f1'], { blocked: true }), issue(2, ['f2']), issue(3, ['f3'])];
    assert.deepEqual(
      counts(
        issueAnswer({
          summary: { flowsInMaintenance: 40, flowsBlocked: 31, flowsNotBlocked: 9 },
          items: three,
        }),
      ),
      [40, 31, 9, false],
    );
    // Nothing stated: the listed reports' flows are counted, and a total beside
    // the list counts reports, not flows.
    assert.deepEqual(
      counts({
        total: 2,
        truncated: false,
        items: [issue(1, ['f1', 'f2'], { blocked: true }), issue(2, ['f3'])],
      }),
      [3, 2, 1, false],
    );
    // No report open is an answer, not nothing.
    const none = normalizeMaintenanceStatus(
      issueAnswer({
        summary: { flowsInMaintenance: 0, flowsBlocked: 0, flowsNotBlocked: 0 },
        items: [],
      }),
      NOW,
    );
    assert.deepEqual(none.issues, []);
    assert.deepEqual([none.flowsInMaintenance, none.blockedFlows, none.actionableFlows], [0, 0, 0]);
  });

  test('a list of reports is cut short when flagged so, or when it holds fewer than stated', () => {
    const flagged = normalizeMaintenanceStatus(
      issueAnswer({
        summary: { truncated: true, flowsInMaintenance: 9, flowsBlocked: 4, flowsNotBlocked: 5 },
        items: [issue(1, ['f1'])],
      }),
      NOW,
    );
    assert.equal(flagged.truncated, true);
    // The counts were stated, so they are not floors.
    assert.equal(flagged.partial, false);
    assert.deepEqual([flagged.blockedFlows, flagged.actionableFlows], [4, 5]);

    const short = normalizeMaintenanceStatus(
      issueAnswer({
        summary: { openMaintenanceIssues: 5 },
        items: [issue(1, ['f1'], { blocked: true })],
      }),
      NOW,
    );
    assert.equal(short.truncated, true);
    assert.equal(short.partial, true);
    assert.deepEqual(
      [short.flowsInMaintenance, short.blockedFlows, short.actionableFlows],
      [null, 1, null],
    );
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

  test('JSON with no list in it is unknown, not "no open tasks"; a list of nothing is zero', () => {
    assert.equal(normalizeTasks({ message: 'No customer matched' }, NOW), null);
    assert.equal(normalizeTasks({ error: 'customer not found' }, NOW), null);
    assert.equal(normalizeTasks({}, NOW), null);
    assert.equal(normalizeTasks({ error: 'x', details: ['no such customer'] }, NOW), null);
    // A count with no list behind it names nobody, so it is no answer either.
    assert.equal(normalizeTasks({ total: 3 }, NOW), null);

    const none = { tasks: [], truncated: false };
    assert.deepEqual(normalizeTasks({ total: 0, items: [] }, NOW), none);
    assert.deepEqual(normalizeTasks({ tasks: [] }, NOW), none);
    assert.deepEqual(normalizeTasks({ data: { items: [] } }, NOW), none);
    assert.deepEqual(normalizeTasks([], NOW), none);
    assert.deepEqual(normalizeTasks({ total: 0 }, NOW), none);
  });

  test('error JSON carrying arrays of objects is no answer, not a list of open tasks', () => {
    for (const raw of [
      { errors: [{ message: 'customer not found' }] },
      { error: 'x', details: [{ field: 'customer' }] },
      { message: 'No customer matched', warnings: [{ code: 'fuzzy_match' }] },
      { Problems: [{ id: 't1', type: 'maintenance', status: 'open' }] },
      { data: { errors: [{ message: 'timeout' }] } },
    ]) {
      assert.equal(normalizeTasks(raw, NOW), null, JSON.stringify(raw));
    }
    // A stated zero beside the error still counts, as it does alone.
    assert.deepEqual(normalizeTasks({ total: 0, warnings: [{ code: 'slow' }] }, NOW), {
      tasks: [],
      truncated: false,
    });
  });

  test('a task list is cut short by the same reading as the maintenance list', () => {
    const rows = [{ id: 't1', type: 'maintenance', status: 'open' }];
    for (const raw of [
      { truncated: true, items: rows },
      { hasMore: true, items: rows },
      { has_more: 'true', items: rows },
      { total: 5, items: rows },
      { data: { total: 5, items: rows } },
      { result: { items: rows, hasMore: true } },
      { data: { count: 3, items: [] } },
    ]) {
      assert.equal(normalizeTasks(raw, NOW).truncated, true, JSON.stringify(raw));
    }
    for (const raw of [
      { items: rows },
      { total: 1, hasMore: false, items: rows },
      { data: { total: 1, truncated: false, items: rows } },
      // The total counts the rows sent, closed ones included.
      { total: 2, items: [...rows, { id: 't2', type: 'maintenance', status: 'done' }] },
    ]) {
      assert.equal(normalizeTasks(raw, NOW).truncated, false, JSON.stringify(raw));
    }
  });

  test('open tasks all of types that do not read as maintenance are unknown, not zero', () => {
    // find_tasks declares no maintenance type, so it was asked for every type.
    const schema = {
      type: 'object',
      properties: {
        customer: { type: 'string' },
        type: { type: 'string', enum: ['bug', 'upkeep', 'feature'] },
      },
    };
    assert.deepEqual(pickTaskArguments(schema, acme).arguments, { customer: 'acme' });
    const everyType = normalizeTasks(
      {
        items: [
          { id: 't1', type: 'upkeep', status: 'open', assignee: 'Kalley' },
          { id: 't2', type: 'bug', status: 'open', assignee: 'Rae' },
        ],
      },
      NOW,
    );
    assert.equal(everyType, null);
    assert.equal(summarizeTaskWolfCustomer({ tasks: everyType }).openTasks, null);

    // Nothing open is zero whatever the types; a row of a maintenance type
    // shows the open ones beside it are something else.
    assert.deepEqual(
      normalizeTasks({ items: [{ id: 't1', type: 'upkeep', status: 'done' }] }, NOW).tasks,
      [],
    );
    assert.deepEqual(
      normalizeTasks(
        {
          items: [
            { id: 't1', type: 'test-creation', status: 'todo' },
            { id: 't2', type: 'test-maintenance', status: 'done' },
          ],
        },
        NOW,
      ).tasks,
      [],
    );
  });

  test('a due date in epoch seconds is overdue only once it has passed', () => {
    const seconds = (days) => Math.floor((NOW + days * 86400000) / 1000);
    const raw = {
      items: [
        { id: 't1', type: 'maintenance', dueDate: seconds(5), createdAt: seconds(-4) },
        { id: 't2', type: 'maintenance', dueDate: seconds(-2), createdAt: seconds(-30) },
        { id: 't3', type: 'maintenance', dueDate: NOW + 5 * 86400000, createdAt: daysAgo(4) },
      ],
    };
    assert.deepEqual(
      normalizeTasks(raw, NOW).tasks.map((t) => [t.id, t.overdue, t.ageDays]),
      [
        ['t1', false, 4],
        ['t2', true, 30],
        ['t3', false, 4],
      ],
    );
  });

  test('a task is blocked by the same reading as a flow', () => {
    const raw = {
      items: [
        { id: 't1', type: 'maintenance', status: 'unblocked' },
        { id: 't2', type: 'maintenance', status: 'not_blocked' },
        { id: 't3', type: 'maintenance', status: 'blocked', blocked: 0 },
        { id: 't4', type: 'maintenance', status: 'open', blocker: {} },
        {
          id: 't5',
          type: 'maintenance',
          status: 'open',
          blocker: { title: 'Env', resolved: true },
        },
        { id: 't6', type: 'maintenance', status: 'open', blocked: 1 },
        { id: 't7', type: 'maintenance', status: 'open', blocker: { title: 'Env down' } },
      ],
    };
    assert.deepEqual(
      normalizeTasks(raw, NOW).tasks.map((t) => [t.id, t.blocked, t.blockerTitle]),
      [
        ['t1', false, ''],
        ['t2', false, ''],
        ['t3', false, ''],
        ['t4', false, ''],
        ['t5', false, ''],
        ['t6', true, ''],
        ['t7', true, 'Env down'],
      ],
    );
  });

  // `find_tasks` as Task Wolf answers it: the first page of rows, and counts
  // for the whole list beside it.
  const taskRow = (n, status) => ({
    id: `TSK-${n}`,
    name: `Repair flow ${n}`,
    type: 'testMaintenance',
    status,
    priority: 'medium',
    effort: 'medium',
    dueAt: '2026-09-20',
    completedAt: null,
    assignee: n % 2 ? 'Rowan Pike' : 'Tomas Wren',
    customer: 'Acme',
    blocker: status === 'blocked' ? SSO : null,
    url: `https://tasks.example.test/t/${n}`,
  });
  const firstPage = [
    taskRow(1, 'blocked'),
    taskRow(2, 'blocked'),
    taskRow(3, 'blocked'),
    taskRow(4, 'toDo'),
    taskRow(5, 'scheduled'),
  ];
  const cutShort = {
    scope: { customer: 'Acme' },
    total: 30,
    truncated: true,
    byStatus: { blocked: 21, toDo: 8, scheduled: 1 },
    byType: { testMaintenance: 30 },
    items: firstPage,
  };

  test('a page cut short takes the open and blocked counts stated for the whole list', () => {
    const out = normalizeTasks(cutShort, NOW);
    assert.equal(out.tasks.length, 5);
    assert.equal(out.truncated, true);
    assert.deepEqual([out.openTotal, out.blockedTotal], [30, 21]);
    const customer = summarizeTaskWolfCustomer({ tasks: out });
    assert.deepEqual([customer.openTasks, customer.blockedTasks], [30, 21]);
    // Overdue and who is on it are read off the page sent.
    assert.equal(customer.overdueTasks, 5);
    assert.deepEqual(customer.assignees, ['Rowan Pike', 'Tomas Wren']);
    // Closed statuses in the counts are not open tasks.
    const withDone = { ...cutShort, byStatus: { ...cutShort.byStatus, done: 40 } };
    assert.equal(normalizeTasks(withDone, NOW).openTotal, 30);
    // A bare total counts open tasks, as none but open ones were asked for;
    // the blocked count is then the page's.
    const bare = normalizeTasks({ total: 12, truncated: true, items: firstPage }, NOW);
    assert.deepEqual([bare.openTotal, bare.blockedTotal], [12, undefined]);
    assert.deepEqual(
      [
        summarizeTaskWolfCustomer({ tasks: bare }).openTasks,
        summarizeTaskWolfCustomer({ tasks: bare }).blockedTasks,
      ],
      [12, 3],
    );
  });

  test('stated counts that take in rows this reading drops are left out; a whole list stands', () => {
    const pageCount = (raw) => {
      const out = normalizeTasks(raw, NOW);
      assert.deepEqual([out.openTotal, out.blockedTotal], [undefined, undefined]);
      return summarizeTaskWolfCustomer({ tasks: out }).openTasks;
    };
    // Another task type counted beside maintenance.
    assert.equal(pageCount({ ...cutShort, byType: { testMaintenance: 26, testCreation: 4 } }), 5);
    // A closed row on the page: the bare total counts closed ones too.
    assert.equal(pageCount({ total: 12, items: [...firstPage, taskRow(6, 'done')] }), 5);
    // Not cut short: the rows are the whole list, and nothing is added to them.
    assert.deepEqual(
      Object.keys(normalizeTasks({ ...cutShort, total: 5, truncated: false }, NOW)),
      ['tasks', 'truncated'],
    );
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
    assert.deepEqual(customerTw.listedFlowIds, ['f1', 'f2', 'f3']);
    assert.deepEqual(customerTw.flowBlockers, { f1: 'Staging down', f3: 'Staging down' });
    assert.equal(customerTw.partial, false);
    assert.equal(customerTw.truncated, false);
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
    assert.equal(partly.taskWolf.actionableFlows, 1);
    assert.equal(partly.taskWolf.unlistedFlows, 0);
  });

  test('a QAE is on a report only through its own flows; the customer-wide ones are kept apart', () => {
    const picked = annotateReport({ flowIds: ['f1', 'f2'], flowCount: 2 }, customerTw);
    assert.deepEqual(picked.taskWolf.assignees, ['Jordy']);
    assert.deepEqual(picked.taskWolf.customerAssignees, ['Kalley']);

    // Nobody picked up f1 or f3: Kalley has a task for the customer, not for this report.
    const untouched = annotateReport({ flowIds: ['f1', 'f3'], flowCount: 2 }, customerTw);
    assert.deepEqual(untouched.taskWolf.assignees, []);
    assert.deepEqual(untouched.taskWolf.customerAssignees, ['Kalley']);
  });

  test('a flow Task Wolf did not list is unknown, never free', () => {
    // Task Wolf ids its entries its own way, so none line up with the report's flows.
    const allBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        {
          total: 2,
          items: [
            { id: 'mnt_1', blocked: true },
            { id: 'mnt_2', blocked: true },
          ],
        },
        NOW,
      ),
    });
    assert.equal(allBlocked.blockedFlows, 2);
    assert.equal(allBlocked.actionableFlows, 0);
    const report = annotateReport({ flowIds: ['pf-1', 'pf-2'], flowCount: 2 }, allBlocked);
    assert.equal(report.taskWolf.blocked, true); // the customer-wide count decides
    assert.equal(report.taskWolf.unlistedFlows, 2);

    // One flow listed as blocked, the other not listed, customer mixed: unknown.
    const mixed = annotateReport({ flowIds: ['f1', 'pf-9'], flowCount: 2 }, customerTw);
    assert.equal(mixed.taskWolf.blocked, null);
    assert.equal(mixed.taskWolf.blockedFlows, 1);
    assert.equal(mixed.taskWolf.unlistedFlows, 1);

    // One flow listed as free is work to do, whatever the unlisted one turns out to be.
    const oneFree = annotateReport({ flowIds: ['f2', 'pf-9'], flowCount: 2 }, customerTw);
    assert.equal(oneFree.taskWolf.blocked, false);
    assert.equal(oneFree.taskWolf.actionableFlows, 1);
    assert.equal(oneFree.taskWolf.unlistedFlows, 1);
  });

  test('a list cut short speaks only for the flows on it', () => {
    const cutShort = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        {
          total: 40,
          truncated: true,
          items: [
            { flowId: 'f1', blocked: true, blocker: 'Env' },
            { flowId: 'f2', blocked: false },
          ],
        },
        NOW,
      ),
    });
    assert.equal(cutShort.partial, true);
    assert.equal(cutShort.truncated, true);
    assert.equal(cutShort.blockedFlows, 1);
    assert.equal(cutShort.actionableFlows, 1);
    const annotate = (flowIds) =>
      annotateReport({ flowIds, flowCount: flowIds.length }, cutShort).taskWolf;
    assert.equal(annotate(['f1']).blocked, true);
    assert.equal(annotate(['f2']).blocked, false);
    assert.equal(annotate(['f39']).blocked, null);
    assert.equal(annotate(['f39']).partial, true);

    // A floor of zero blocked is not "none blocked".
    const noneListedBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        { total: 40, truncated: true, items: [{ flowId: 'f2', blocked: false }] },
        NOW,
      ),
    });
    assert.equal(noneListedBlocked.blockedFlows, null);

    // Short of the stated total with no flag from the server: still truncated.
    const unflagged = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        { total: 40, items: [{ flowId: 'f1', blocked: true }] },
        NOW,
      ),
    });
    assert.equal(unflagged.truncated, true);
    assert.equal(unflagged.partial, true);
    assert.equal(
      annotateReport({ flowIds: ['f39'], flowCount: 1 }, noneListedBlocked).taskWolf.blocked,
      null,
    );
  });

  test('an empty answer says nothing about the customer, so its reports stay unknown', () => {
    const empty = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ total: 0, truncated: false, items: [] }, NOW),
    });
    assert.equal(empty.flowsInMaintenance, 0);
    assert.equal(annotateReport({ flowIds: ['pf-1'], flowCount: 1 }, empty).taskWolf.blocked, null);

    const unmatched = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ message: 'No customer matched' }, NOW),
    });
    assert.equal(unmatched.flowsInMaintenance, null);
    assert.equal(unmatched.blockedFlows, null);
    assert.equal(
      annotateReport({ flowIds: ['pf-1'], flowCount: 1 }, unmatched).taskWolf.blocked,
      null,
    );
  });

  test("the blocker named is the one on the report's own flows", () => {
    const twoBlockers = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        {
          total: 4,
          items: [
            { flowId: 'f1', blocked: true, blocker: { title: 'Staging down' } },
            { flowId: 'f2', blocked: true, blocker: { title: 'Staging down' } },
            { flowId: 'f3', blocked: true, blocker: { title: 'Waiting on creds' } },
            { flowId: 'f4', blocked: true },
          ],
        },
        NOW,
      ),
    });
    assert.equal(twoBlockers.blockers[0].title, 'Staging down');
    const titleFor = (flowIds) =>
      annotateReport({ flowIds, flowCount: flowIds.length }, twoBlockers).taskWolf.blockerTitle;
    assert.equal(titleFor(['f3']), 'Waiting on creds');
    assert.equal(titleFor(['f1', 'f2', 'f3']), 'Staging down');
    // Blocked with no reason given: not another flow's reason.
    assert.equal(titleFor(['f4']), 'Blocked');
    // Decided by the customer-wide count, so the customer's blocker stands in.
    assert.equal(titleFor(['pf-1']), 'Staging down');
  });

  test('who is on it survives a maintenance answer that failed or was never offered', () => {
    const tasksOnly = summarizeTaskWolfCustomer({ maintenance: null, tasks });
    assert.equal(tasksOnly.flowsInMaintenance, null);
    // No list at all, which is not a list of nothing.
    assert.equal(tasksOnly.listedFlowIds, null);
    assert.equal(tasksOnly.blockedFlowIds, null);
    const report = annotateReport({ flowIds: ['f1', 'f2'], flowCount: 2 }, tasksOnly);
    assert.equal(report.taskWolf.blocked, null);
    assert.deepEqual(report.taskWolf.assignees, []);
    assert.deepEqual(report.taskWolf.customerAssignees, ['Kalley']);
    assert.equal(report.taskWolf.openTasks, 1);
    // Nothing was said about the report's flows: unknown, not zero of each.
    assert.equal(report.taskWolf.blockedFlows, null);
    assert.equal(report.taskWolf.actionableFlows, null);
    assert.equal(report.taskWolf.unlistedFlows, null);
    assert.equal(report.taskWolf.blockedFlowIds, null);
    assert.equal(report.taskWolf.freeFlowIds, null);
  });

  test('a report that parks no flows gets no verdict, whatever the customer-wide count says', () => {
    const allBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ inMaintenance: 4, blocked: 4, unblocked: 0 }, NOW),
    });
    const noneBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ inMaintenance: 4, blocked: 0 }, NOW),
    });
    const tasksOnly = summarizeTaskWolfCustomer({ maintenance: null, tasks });
    for (const [name, tw] of Object.entries({ allBlocked, noneBlocked, customerTw, tasksOnly })) {
      for (const report of [{ flowIds: [], flowCount: 0 }, { flowCount: 0 }]) {
        const out = annotateReport(report, tw).taskWolf;
        assert.equal(out.blocked, null, name);
        assert.equal(out.blockerTitle, '', name);
        // No flows is the platform's word, so none of them is blocked, free or unlisted.
        assert.deepEqual(
          [out.blockedFlows, out.actionableFlows, out.unlistedFlows],
          [0, 0, 0],
          name,
        );
        assert.deepEqual([out.blockedFlowIds, out.freeFlowIds], [[], []], name);
      }
    }
  });

  test('a report names which of its own flows Task Wolf listed as blocked and as free', () => {
    const own = (flowIds) =>
      annotateReport({ flowIds, flowCount: flowIds.length }, customerTw).taskWolf;
    // f3 is blocked for the customer but not parked here, so it is not named.
    assert.deepEqual(own(['f1', 'f2', 'pf-9']).blockedFlowIds, ['f1']);
    assert.deepEqual(own(['f1', 'f2', 'pf-9']).freeFlowIds, ['f2']);
    assert.deepEqual(own(['f1', 'f3']).blockedFlowIds, ['f1', 'f3']);
    assert.deepEqual(own(['f1', 'f3']).freeFlowIds, []);
    assert.deepEqual([own(['pf-9']).blockedFlowIds, own(['pf-9']).freeFlowIds], [[], []]);
    // Two reports parking the same flow both name it, so the page can count it once.
    assert.deepEqual(own(['f2']).freeFlowIds, own(['f2', 'f1']).freeFlowIds);
    // The ids agree with the counts.
    const mixed = own(['f1', 'f2', 'pf-9']);
    assert.equal(mixed.blockedFlowIds.length, mixed.blockedFlows);
    assert.equal(mixed.freeFlowIds.length, mixed.actionableFlows);
  });

  test('a stated count of none blocked does not free a report whose own flow is listed as blocked', () => {
    // The server's count and its list disagree: the count says none, f1 says blocked.
    const contradicted = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        { total: 3, blocked: 0, items: [{ flowId: 'f1', blocked: true, blocker: 'Env' }] },
        NOW,
      ),
    });
    assert.equal(contradicted.blockedFlows, 0);
    assert.equal(contradicted.actionableFlows, 3);
    assert.equal(contradicted.partial, false);
    const report = annotateReport({ flowIds: ['f1', 'pf-2'], flowCount: 2 }, contradicted);
    assert.equal(report.taskWolf.blocked, null);
    assert.equal(report.taskWolf.blockedFlows, 1);
    assert.equal(report.taskWolf.unlistedFlows, 1);
    // With none of its own flows listed as blocked, the count decides.
    assert.equal(
      annotateReport({ flowIds: ['pf-2'], flowCount: 1 }, contradicted).taskWolf.blocked,
      false,
    );
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

    // No total and no list: both counts given decide as a total would, one alone does not.
    const verdictFor = (raw) =>
      annotateReport(
        { flowIds: ['z'], flowCount: 1 },
        summarizeTaskWolfCustomer({ maintenance: normalizeMaintenanceStatus(raw, NOW) }),
      ).taskWolf.blocked;
    assert.equal(verdictFor({ blocked: 0, actionable: 5 }), false);
    assert.equal(verdictFor({ blocked: 4, actionable: 0 }), true);
    assert.equal(verdictFor({ blocked: 2 }), null);
    const onlyBlocked = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({ blocked: 2 }, NOW),
    });
    assert.equal(onlyBlocked.flowsInMaintenance, null);
    assert.equal(onlyBlocked.actionableFlows, null);
  });

  const byReport = summarizeTaskWolfCustomer({
    maintenance: normalizeMaintenanceStatus(twoReports, NOW),
    tasks,
  });

  test('answered by report, the roll-up carries each verdict and fills the flow maps from its flows', () => {
    assert.deepEqual(byReport.issues, [
      {
        issueId: 'iss_201',
        number: 201,
        blocked: true,
        blockerTitle: SSO,
        assignees: ['Rowan Pike', 'Ines Calder'],
      },
      {
        issueId: 'iss_202',
        number: 202,
        blocked: false,
        blockerTitle: '',
        assignees: ['Tomas Wren'],
      },
    ]);
    assert.equal(byReport.issuesCutShort, false);
    assert.deepEqual([byReport.blockedFlows, byReport.actionableFlows], [2, 1]);
    assert.deepEqual(byReport.listedFlowIds, ['wf-a', 'wf-b', 'wf-c']);
    assert.deepEqual(byReport.blockedFlowIds, ['wf-a', 'wf-b']);
    assert.deepEqual(byReport.flowBlockers, { 'wf-a': SSO, 'wf-b': SSO });
    assert.deepEqual(byReport.flowAssignees, {
      'wf-a': 'Rowan Pike',
      'wf-b': 'Rowan Pike',
      'wf-c': 'Tomas Wren',
    });
    // Answered by flow, there are no reports to go by.
    assert.equal(customerTw.issues, null);
  });

  test("answered by report, a report takes its own entry's verdict, blocker and QAEs, flows and all", () => {
    // The platform parks a flow on 201 that Task Wolf did not name: the verdict is the report's.
    const blocked = annotateReport(
      { issueId: 'iss_201', number: 201, flowIds: ['wf-a', 'wf-b', 'wf-z'], flowCount: 3 },
      byReport,
    ).taskWolf;
    assert.deepEqual(blocked, {
      blocked: true,
      blockedFlows: 3,
      actionableFlows: 0,
      unlistedFlows: 0,
      blockedFlowIds: ['wf-a', 'wf-b', 'wf-z'],
      freeFlowIds: [],
      partial: false,
      blockerTitle: SSO,
      assignees: ['Rowan Pike', 'Ines Calder'],
      customerAssignees: ['Kalley'],
      openTasks: 1,
    });
    const free = annotateReport(
      { issueId: 'iss_202', number: 202, flowIds: ['wf-c'], flowCount: 1 },
      byReport,
    ).taskWolf;
    assert.deepEqual(free, {
      blocked: false,
      blockedFlows: 0,
      actionableFlows: 1,
      unlistedFlows: 0,
      blockedFlowIds: [],
      freeFlowIds: ['wf-c'],
      partial: false,
      blockerTitle: '',
      assignees: ['Tomas Wren'],
      customerAssignees: ['Kalley'],
      openTasks: 1,
    });
  });

  test('a report is matched by issueId first, and by its number when the ids differ', () => {
    const byNumber = annotateReport(
      { issueId: 'plat-7f3e', number: 201, flowIds: ['p1'], flowCount: 1 },
      byReport,
    ).taskWolf;
    assert.equal(byNumber.blocked, true);
    assert.deepEqual(byNumber.blockedFlowIds, ['p1']);
    assert.equal(byNumber.blockerTitle, SSO);
    assert.deepEqual(byNumber.assignees, ['Rowan Pike', 'Ines Calder']);
    // The id beats a number that belongs to another report.
    assert.equal(
      annotateReport({ issueId: 'iss_202', number: 201, flowIds: ['p1'], flowCount: 1 }, byReport)
        .taskWolf.blocked,
      false,
    );
  });

  test('a report Task Wolf does not list gets no verdict, whatever the customer-wide counts say', () => {
    const unlisted = { issueId: 'iss_999', number: 999, flowIds: ['wf-q', 'wf-r'], flowCount: 2 };
    const verdictOn = (raw) =>
      annotateReport(
        unlisted,
        summarizeTaskWolfCustomer({ maintenance: normalizeMaintenanceStatus(raw, NOW) }),
      ).taskWolf;

    // A whole list without it: Task Wolf does not have it open, even when every
    // one of the customer's flows is blocked, or none is.
    for (const summary of [
      { flowsInMaintenance: 1, flowsBlocked: 1, flowsNotBlocked: 0 },
      { flowsInMaintenance: 1, flowsBlocked: 0, flowsNotBlocked: 1 },
    ]) {
      const blocked = summary.flowsBlocked > 0;
      assert.deepEqual(
        verdictOn(issueAnswer({ summary, items: [issue(1, ['wf-x'], { blocked })] })),
        {
          blocked: null,
          blockedFlows: 0,
          actionableFlows: 0,
          unlistedFlows: 2,
          blockedFlowIds: [],
          freeFlowIds: [],
          partial: false,
          blockerTitle: '',
          assignees: [],
          customerAssignees: [],
          openTasks: null,
        },
      );
    }
    // A flow it shares with a listed blocked report does not decide it either.
    assert.equal(
      annotateReport({ ...unlisted, flowIds: ['wf-a'], flowCount: 1 }, byReport).taskWolf.blocked,
      null,
    );

    // A list cut short, flagged or holding fewer reports than stated: unknown, and said so.
    for (const summary of [{ truncated: true }, { openMaintenanceIssues: 4 }]) {
      const out = verdictOn(
        issueAnswer({ summary, items: [issue(1, ['wf-x'], { blocked: true })] }),
      );
      assert.equal(out.blocked, null, JSON.stringify(summary));
      assert.equal(out.unlistedFlows, 2, JSON.stringify(summary));
      assert.equal(out.partial, true, JSON.stringify(summary));
    }
  });
});

describe('isCustomerNotFound', () => {
  const toolError = (text, tool = 'get_maintenance_status') => {
    try {
      parseToolResult({ isError: true, content: [{ type: 'text', text }] }, tool);
    } catch (error) {
      return error;
    }
    return null;
  };

  test("recognises Task Wolf's answer for a customer it does not have, and nothing else", () => {
    assert.equal(
      isCustomerNotFound(toolError('No customer matched "acme". Use find_customer to search.')),
      true,
    );
    // As the pass records it, beside the tool that answered.
    assert.equal(
      isCustomerNotFound({
        tool: 'find_tasks',
        code: 'TW_TOOL',
        message:
          'Task Wolf find_tasks: No customer matched "team-acme". Use find_customer to search.',
      }),
      true,
    );
    assert.equal(isCustomerNotFound(toolError('customer: Required')), false);
    assert.equal(
      isCustomerNotFound({ code: 'TW_UPSTREAM', message: 'No customer matched "acme"' }),
      false,
    );
    assert.equal(isCustomerNotFound(new Error('No customer matched "acme"')), false);
    assert.equal(isCustomerNotFound(null), false);
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
    assert.deepEqual(a1.taskWolf.blockedFlowIds, ['f1', 'f3']);
    assert.deepEqual(a2.taskWolf.freeFlowIds, ['f2']);
    assert.equal(g1.taskWolf, null);
    // Kalley's task is for the customer; nobody is on f2 itself.
    assert.deepEqual(a2.taskWolf.assignees, []);
    assert.deepEqual(a2.taskWolf.customerAssignees, ['Kalley']);

    assert.equal(merged.totals.customersWithTaskWolf, 1);
    assert.equal(merged.totals.blockedFlows, 2);
    assert.equal(merged.totals.actionableFlows, 1);
    assert.equal(merged.totals.blockedReports, 1);
    assert.equal(merged.totals.actionableReports, 1);
    assert.equal(merged.totals.reportsWithQae, 0);
    // Platform totals are untouched.
    assert.equal(merged.totals.openReports, 3);
    assert.equal(merged.taskWolf.enabled, true);
    assert.equal(merged.taskWolf.customersAnswered, 1);
    assert.equal(merged.taskWolf.customersPartial, 0);
    assert.equal(merged.taskWolf.errors.length, 1);
  });

  test('counts Task Wolf never gave stay null in the totals, and a partial list is flagged', () => {
    const globex = { id: 'team-globex', name: 'Globex', slug: 'globex' };
    const report = (issueId, flowId) => ({
      issueId,
      number: 1,
      name: issueId,
      status: 'pending',
      createdAt: daysAgo(10),
      reproductions: [{ flowId }],
    });
    const snapshot = buildSnapshot({
      workspaces: [acme, globex],
      reportsByWorkspace: new Map([
        ['team-acme', [report('a1', 'f1')]],
        ['team-globex', [report('g1', 'g1')]],
      ]),
      excludedSlugs: parseExcludedSlugs(undefined),
      now: NOW,
    });
    const kalleyTask = normalizeTasks(
      { items: [{ id: 't', type: 'maintenance', status: 'open', assignee: 'Kalley' }] },
      NOW,
    );

    // get_maintenance_status failed for Acme; only find_tasks answered.
    const tasksOnly = mergeTaskWolf(
      snapshot,
      new Map([['team-acme', summarizeTaskWolfCustomer({ maintenance: null, tasks: kalleyTask })]]),
      { enabled: true, customersQueried: 2 },
    );
    assert.equal(tasksOnly.totals.customersWithTaskWolf, 1);
    assert.equal(tasksOnly.totals.blockedFlows, null);
    assert.equal(tasksOnly.totals.actionableFlows, null);
    assert.equal(tasksOnly.totals.blockedReports, 0);
    assert.equal(tasksOnly.totals.actionableReports, 0);
    const a1 = tasksOnly.reports.find((r) => r.issueId === 'a1');
    assert.equal(a1.taskWolf.blocked, null);
    assert.equal(a1.taskWolf.blockedFlows, null);
    assert.equal(a1.taskWolf.actionableFlows, null);
    assert.equal(a1.taskWolf.unlistedFlows, null);
    assert.deepEqual(a1.taskWolf.customerAssignees, ['Kalley']);

    // Globex's list was cut short: its blocked count is a floor, actionable unknown.
    const cutShort = mergeTaskWolf(
      snapshot,
      new Map([
        [
          'team-globex',
          summarizeTaskWolfCustomer({
            maintenance: normalizeMaintenanceStatus(
              { total: 40, truncated: true, items: [{ flowId: 'g9', blocked: true }] },
              NOW,
            ),
          }),
        ],
      ]),
      { enabled: true, customersQueried: 2 },
    );
    assert.equal(cutShort.totals.blockedFlows, 1);
    assert.equal(cutShort.totals.actionableFlows, null);
    assert.equal(cutShort.taskWolf.customersPartial, 1);
    assert.equal(cutShort.reports.find((r) => r.issueId === 'g1').taskWolf.blocked, null);

    // Acme stated a blocked count and nothing else: actionable is not zero.
    const blockedOnly = mergeTaskWolf(
      snapshot,
      new Map([
        [
          'team-acme',
          summarizeTaskWolfCustomer({
            maintenance: normalizeMaintenanceStatus({ blocked: 2 }, NOW),
          }),
        ],
      ]),
      { enabled: true, customersQueried: 2 },
    );
    assert.equal(blockedOnly.totals.blockedFlows, 2);
    assert.equal(blockedOnly.totals.actionableFlows, null);
  });

  test("answered by report, the platform's reports take Task Wolf's verdicts and the summary's flow counts", () => {
    const report = (number, flowIds) => ({
      issueId: `iss_${number}`,
      number,
      name: `Report ${number}`,
      status: 'inProgress',
      createdAt: daysAgo(20),
      reproductions: flowIds.map((flowId) => ({ flowId })),
    });
    const snapshot = buildSnapshot({
      workspaces: [acme],
      reportsByWorkspace: new Map([
        ['team-acme', [report(201, ['f1', 'f2']), report(202, ['f3']), report(203, ['f4'])]],
      ]),
      excludedSlugs: parseExcludedSlugs(undefined),
      now: NOW,
    });
    const acmeTw = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus(
        issueAnswer({
          summary: { flowsInMaintenance: 40, flowsBlocked: 37, flowsNotBlocked: 3 },
          items: [
            issue(201, ['f1', 'f2'], {
              blocked: true,
              blocker: { title: SSO, description: '' },
              assignees: ['Rowan Pike'],
            }),
            issue(202, ['f3'], { assignees: ['Tomas Wren'] }),
          ],
        }),
        NOW,
      ),
    });
    const merged = mergeTaskWolf(snapshot, new Map([['team-acme', acmeTw]]), {
      enabled: true,
      customersQueried: 1,
    });
    const verdicts = Object.fromEntries(
      merged.reports.map((r) => [r.number, [r.taskWolf.blocked, r.taskWolf.assignees]]),
    );
    assert.deepEqual(verdicts, {
      201: [true, ['Rowan Pike']],
      202: [false, ['Tomas Wren']],
      203: [null, []],
    });
    assert.equal(merged.totals.blockedFlows, 37);
    assert.equal(merged.totals.actionableFlows, 3);
    assert.equal(merged.totals.blockedReports, 1);
    assert.equal(merged.totals.actionableReports, 1);
    assert.equal(merged.totals.reportsWithQae, 2);
    assert.equal(merged.taskWolf.customersPartial, 0);
  });
});
