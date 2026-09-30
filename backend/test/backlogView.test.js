/**
 * View rules for the Bone Pile page: what the tiles total, what the toolbar
 * keeps, and what the CSV and the Slack digest say.
 *
 * This file tests frontend code from the backend suite. The frontend has no
 * test runner, and backlogView.js is pure and imports nothing, so node:test can
 * load it by path. It can move next to the module once the frontend has one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  asSentence,
  claimFilterIds,
  claimReminders,
  claimTag,
  claimTimeLeft,
  claimsByWorkspace,
  customerOldestLabel,
  customerReportsLabel,
  customersWithVisibleReports,
  describeScanError,
  describeTaskWolfTokenExpiry,
  describeTruncatedWorkspaces,
  filterCustomers,
  filterReports,
  floorMark,
  formatCalendarDay,
  formatDate,
  isClaimExpiring,
  listNames,
  localIsoDate,
  reportsToCsv,
  slackSummary,
  summarize,
  taskWolfAssignees,
  taskWolfBadge,
  taskWolfBlockedLabel,
  taskWolfFlowSplit,
  taskWolfFlowsLabel,
  taskWolfNotFoundLevel,
  taskWolfQae,
  taskWolfReportsLabel,
} from '../../frontend/src/projects/maintenance-dashboard/backlogView.js';
import {
  annotateReport,
  normalizeMaintenanceStatus,
  normalizeTasks,
  summarizeTaskWolfCustomer,
} from '../src/projects/maintenance-dashboard/taskWolfShape.js';

let nextIssue = 0;

/** A report row as the snapshot publishes it. */
function row(overrides = {}) {
  nextIssue += 1;
  const flowIds = overrides.flowIds || [`flow-${nextIssue}`];
  return {
    issueId: `issue-${nextIssue}`,
    number: 231,
    name: 'SSO login',
    status: 'inProgress',
    priority: 'medium',
    priorityRank: 2,
    createdAt: '2026-09-18T18:00:00.000Z',
    ageDays: 10,
    flowCount: flowIds.length,
    healedFlowCount: 0,
    description: '',
    url: 'https://app.qawolf.com/acme/maintenance-reports/x',
    workspaceId: 'ws-acme',
    workspaceName: 'Acme',
    workspaceSlug: 'acme',
    organizationName: 'Acme Corp',
    isDemo: false,
    taskWolf: null,
    ...overrides,
    flowIds,
  };
}

/** A customer row as the snapshot publishes it. */
function customer(overrides = {}) {
  return {
    workspaceId: 'ws-acme',
    name: 'Acme',
    slug: 'acme',
    organizationName: 'Acme Corp',
    isDemo: false,
    openReports: 1,
    flowsInMaintenance: 2,
    oldestReportAgeDays: 10,
    taskWolf: null,
    ...overrides,
  };
}

/** Task Wolf's word on a row, with the fields annotateReport publishes. */
const verdict = (blocked, extra = {}) => ({
  blocked,
  blockedFlows: 0,
  actionableFlows: 0,
  unlistedFlows: 0,
  partial: false,
  blockerTitle: '',
  assignees: [],
  customerAssignees: [],
  openTasks: null,
  ...extra,
});
const blocked = (extra = {}) =>
  verdict(true, { blockerTitle: 'Waiting on staging credentials', ...extra });
const actionable = (extra = {}) => verdict(false, extra);
const unknown = (extra = {}) => verdict(null, extra);

/** The same from a snapshot built before the verdict fields: fewer of them. */
const olderVerdict = (blocked, blockedFlows = 0) => ({
  blocked,
  blockedFlows,
  blockerTitle: '',
  assignees: [],
});

/** Every order of `items`. */
function permutations(items) {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

/** A count the way the tiles print it, in whatever locale the machine has. */
const printed = (count) => count.toLocaleString();

/** Run `fn` as a viewer in `timeZone`; each test file is its own process. */
function inTimeZone(timeZone, fn) {
  const before = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

/** Records and cells the way a sheet reads them: CR, LF or CRLF ends a record. */
function parseCsv(text) {
  const records = [];
  let record = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || record.length) records.push([...record, cell]);
  return records;
}

describe('summarize', () => {
  test('totals the visible report rows and nothing else', () => {
    // One customer in focus: its two flows, not the 44 / 64 of everyone listed.
    const rows = [row({ flowIds: ['f1', 'f2'], taskWolf: actionable({ actionableFlows: 2 }) })];
    const everyone = [
      customer({
        workspaceId: 'ws-globex',
        taskWolf: { blockedFlows: 44, actionableFlows: 62, flowsInMaintenance: 106 },
      }),
      customer({ taskWolf: { blockedFlows: 0, actionableFlows: 2, flowsInMaintenance: 2 } }),
    ];
    const expected = {
      customers: 1,
      reports: 1,
      flows: 2,
      oldestDays: 10,
      blockedReports: 0,
      actionableReports: 1,
      unknownReports: 0,
      withQae: 0,
      withCustomerQae: 0,
      blockedFlows: 0,
      actionableFlows: 2,
      unknownFlows: 0,
      withTaskWolf: 1,
    };
    assert.deepEqual(summarize(rows), expected);
    assert.deepEqual(summarize(rows, everyone), expected);
  });

  test('counts customers as the distinct workspaces among the rows', () => {
    const rows = [
      row({ workspaceId: 'ws-acme' }),
      row({ workspaceId: 'ws-acme' }),
      row({ workspaceId: 'ws-globex', ageDays: 300 }),
    ];
    const totals = summarize(rows);
    assert.equal(totals.customers, 2);
    assert.equal(totals.reports, 3);
    assert.equal(totals.oldestDays, 300);
  });

  test('splits the flows by what Task Wolf said of the row that parks them', () => {
    const totals = summarize([
      // Blocked: all three, whatever the matched count says.
      row({ flowIds: ['b1', 'b2', 'b3'], taskWolf: blocked({ unlistedFlows: 3 }) }),
      // Actionable on one free flow: one blocked, one free, one not listed.
      row({
        flowIds: ['p1', 'p2', 'p3'],
        taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1, unlistedFlows: 1 }),
      }),
      row({ flowIds: ['a1'], taskWolf: actionable({ actionableFlows: 1, assignees: ['Sam'] }) }),
      // Unknown: the one Task Wolf listed as blocked is blocked, the other unknown.
      row({ flowIds: ['u1', 'u2'], taskWolf: unknown({ blockedFlows: 1, unlistedFlows: 1 }) }),
      row({ flowIds: ['u3'], taskWolf: null }),
    ]);
    assert.equal(totals.flows, 10);
    assert.equal(totals.blockedFlows, 5);
    assert.equal(totals.actionableFlows, 2);
    assert.equal(totals.unknownFlows, 3);
    assert.equal(totals.blockedReports, 1);
    assert.equal(totals.actionableReports, 2);
    assert.equal(totals.unknownReports, 2);
    assert.equal(totals.withTaskWolf, 4);
    assert.equal(totals.withQae, 1);
  });

  test('an actionable row counts as actionable only the flows listed as free', () => {
    // One free flow decides the verdict; the other two were not listed.
    const onOneFlow = summarize([
      row({
        flowIds: ['a1', 'a2', 'a3'],
        taskWolf: actionable({ actionableFlows: 1, unlistedFlows: 2 }),
      }),
    ]);
    assert.equal(onOneFlow.actionableReports, 1);
    assert.equal(onOneFlow.actionableFlows, 1);
    assert.equal(onOneFlow.unknownFlows, 2);
    assert.equal(onOneFlow.blockedFlows, 0);

    // Decided by the customer-wide count: none of its own flows was listed.
    const customerWide = summarize([
      row({ flowIds: ['c1', 'c2'], taskWolf: actionable({ unlistedFlows: 2 }) }),
    ]);
    assert.equal(customerWide.actionableReports, 1);
    assert.equal(customerWide.actionableFlows, 0);
    assert.equal(customerWide.unknownFlows, 2);
  });

  test('a snapshot from before the verdict fields takes what is not blocked as actionable', () => {
    const totals = summarize([
      row({ flowIds: ['p1', 'p2', 'p3'], taskWolf: olderVerdict(false, 1) }),
      row({ flowIds: ['a1'], taskWolf: olderVerdict(false) }),
    ]);
    assert.equal(totals.blockedFlows, 1);
    assert.equal(totals.actionableFlows, 3);
    assert.equal(totals.unknownFlows, 0);
  });

  test('never counts more of a row’s flows than it parks', () => {
    const split = (taskWolf) => {
      const totals = summarize([row({ flowIds: ['f1', 'f2', 'f3'], taskWolf })]);
      assert.equal(totals.flows, 3);
      return [totals.blockedFlows, totals.actionableFlows, totals.unknownFlows];
    };
    assert.deepEqual(split(actionable({ blockedFlows: 5, actionableFlows: 5 })), [3, 0, 0]);
    assert.deepEqual(split(actionable({ blockedFlows: 1, actionableFlows: 9 })), [1, 2, 0]);
    assert.deepEqual(split(actionable({ blockedFlows: -1, actionableFlows: 1 })), [0, 1, 2]);
    assert.deepEqual(split(olderVerdict(false, 7)), [3, 0, 0]);
    // A count that is not a number is unknown, never a number of flows.
    assert.deepEqual(split(actionable({ blockedFlows: null, actionableFlows: 2 })), [0, 2, 1]);
  });

  test('an unknown verdict is unknown, never actionable and never zero blocked', () => {
    const totals = summarize([
      row({ flowIds: ['u1'], taskWolf: { assignees: [] } }),
      row({ flowIds: ['u2'], taskWolf: unknown({ blockedFlows: null, unlistedFlows: 1 }) }),
    ]);
    assert.equal(totals.withTaskWolf, 0);
    assert.equal(totals.unknownReports, 2);
    assert.equal(totals.unknownFlows, 2);
    assert.equal(totals.blockedFlows, 0);
    assert.equal(totals.actionableFlows, 0);
  });

  test('an unknown row counts as blocked the flows Task Wolf listed as blocked', () => {
    const partlyListed = row({
      flowIds: ['u1', 'u2', 'u3'],
      taskWolf: unknown({ blockedFlows: 2, unlistedFlows: 1, partial: true }),
    });
    assert.deepEqual(taskWolfFlowSplit(partlyListed), { blocked: 2, actionable: 0, unknown: 1 });
    // Every visible row is unknown, and Task Wolf still said something.
    const totals = summarize([partlyListed, row({ flowIds: ['u4'], taskWolf: null })]);
    assert.deepEqual(
      [totals.flows, totals.blockedFlows, totals.actionableFlows, totals.unknownFlows],
      [4, 2, 0, 2],
    );
    assert.equal(totals.unknownReports, 2);
    assert.equal(totals.withTaskWolf, 1);
    // Never more than the row parks.
    const overCounted = row({ flowIds: ['u1'], taskWolf: unknown({ blockedFlows: 5 }) });
    assert.deepEqual(taskWolfFlowSplit(overCounted), { blocked: 1, actionable: 0, unknown: 0 });
  });

  test('an unknown row’s blocked count goes to the flow a blocked row parks', () => {
    // Task Wolf listed z1 as blocked; m1 it left out.
    const rows = [
      row({ flowIds: ['m1', 'z1'], taskWolf: unknown({ blockedFlows: 1, unlistedFlows: 1 }) }),
      row({ flowIds: ['z1'], taskWolf: blocked({ blockedFlows: 1 }) }),
    ];
    for (const order of permutations(rows)) {
      const totals = summarize(order);
      assert.deepEqual(
        [totals.flows, totals.blockedFlows, totals.actionableFlows, totals.unknownFlows],
        [2, 1, 0, 1],
      );
    }
  });

  test('counts a flow two reports both park once, so the parts add up to the flows', () => {
    const rows = [
      row({ flowIds: ['shared', 'u1'], taskWolf: null }),
      // `shared` is the one blocked flow this partly blocked report counts.
      row({
        flowIds: ['shared', 'a1'],
        taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1 }),
      }),
      row({ flowIds: ['shared', 'b1'], taskWolf: blocked({ blockedFlows: 2 }) }),
    ];
    for (const order of permutations(rows)) {
      const totals = summarize(order);
      assert.equal(totals.flows, 4);
      assert.equal(totals.blockedFlows, 2);
      assert.equal(totals.actionableFlows, 1);
      assert.equal(totals.unknownFlows, 1);
      assert.equal(
        totals.blockedFlows + totals.actionableFlows + totals.unknownFlows,
        totals.flows,
      );
    }
  });

  test('on a flow two reports park, blocked wins over unknown wins over actionable', () => {
    const rows = [
      row({
        flowIds: ['s1', 's2', 's3', 'a1'],
        taskWolf: actionable({ actionableFlows: 4 }),
      }),
      row({ flowIds: ['s1', 's2'], taskWolf: unknown({ unlistedFlows: 2 }) }),
      row({ flowIds: ['s2', 's3'], taskWolf: blocked({ blockedFlows: 2 }) }),
    ];
    for (const order of permutations(rows)) {
      const totals = summarize(order);
      assert.equal(totals.flows, 4);
      // s2 and s3 blocked, s1 unknown, a1 actionable.
      assert.equal(totals.blockedFlows, 2);
      assert.equal(totals.unknownFlows, 1);
      assert.equal(totals.actionableFlows, 1);
    }
  });

  test('the split is the same whatever the table is sorted by', () => {
    // Task Wolf's blocked flow is `x`. Both reports count it; neither row says
    // which of its flows it is.
    const rows = [
      row({
        name: 'Small',
        flowIds: ['x', 'y'],
        ageDays: 50,
        workspaceName: 'Zebra',
        priorityRank: 3,
        taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1 }),
      }),
      row({
        name: 'Big',
        flowIds: ['z', 'y', 'x'],
        ageDays: 20,
        workspaceName: 'Aardvark',
        priorityRank: 1,
        taskWolf: actionable({ blockedFlows: 1, actionableFlows: 2 }),
      }),
    ];
    const orders = ['age', 'flows', 'customer', 'priority'].map((sortKey) =>
      filterReports(rows, { sortKey }),
    );
    assert.deepEqual(
      orders.map((order) => order[0].name),
      ['Small', 'Big', 'Big', 'Big'],
    );
    for (const order of orders) {
      const totals = summarize(order);
      assert.deepEqual(
        [totals.flows, totals.blockedFlows, totals.actionableFlows, totals.unknownFlows],
        [3, 1, 2, 0],
      );
      assert.deepEqual(totals, summarize(rows));
    }
  });

  test('the split is the same in any order when partly listed reports share flows', () => {
    const rows = [
      row({
        flowIds: ['w', 'x', 'y'],
        taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1, unlistedFlows: 1 }),
      }),
      row({
        flowIds: ['y', 'z', 'x'],
        taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1, unlistedFlows: 1 }),
      }),
      row({ flowIds: ['z', 'v'], taskWolf: unknown({ unlistedFlows: 2 }) }),
      row({ flowIds: ['v', 'q'], taskWolf: blocked({ blockedFlows: 2 }) }),
    ];
    const expected = summarize(rows);
    assert.equal(expected.flows, 6);
    assert.equal(
      expected.blockedFlows + expected.actionableFlows + expected.unknownFlows,
      expected.flows,
    );
    for (const order of permutations(rows)) assert.deepEqual(summarize(order), expected);
  });

  test('counts a QAE on the report apart from a QAE on the customer', () => {
    const totals = summarize([
      row({
        taskWolf: actionable({
          actionableFlows: 1,
          assignees: ['Kalley'],
          customerAssignees: ['Rae'],
        }),
      }),
      row({ taskWolf: blocked({ blockedFlows: 1, customerAssignees: ['Rae'] }) }),
      row({ taskWolf: unknown({ unlistedFlows: 1, customerAssignees: ['Rae', 'Sam'] }) }),
      row({ taskWolf: unknown({ unlistedFlows: 1 }) }),
      row({ taskWolf: null }),
    ]);
    assert.equal(totals.withQae, 1);
    assert.equal(totals.withCustomerQae, 2);
  });

  test('an empty table totals to zero', () => {
    for (const rows of [[], undefined]) {
      const totals = summarize(rows);
      assert.equal(totals.customers, 0);
      assert.equal(totals.reports, 0);
      assert.equal(totals.flows, 0);
      assert.equal(totals.withTaskWolf, 0);
    }
  });
});

describe('taskWolfFlowsLabel and taskWolfReportsLabel', () => {
  test('say what the tiles total, and leave out an unknown part of zero', () => {
    const totals = summarize([
      row({ flowIds: ['b1', 'b2'], taskWolf: blocked({ blockedFlows: 2 }) }),
      row({ flowIds: ['a1'], taskWolf: actionable({ actionableFlows: 1, assignees: ['Sam'] }) }),
    ]);
    assert.equal(
      taskWolfFlowsLabel(totals),
      `${printed(2)} blocked on the customer · ${printed(1)} actionable`,
    );
    assert.equal(
      taskWolfReportsLabel(totals),
      `${printed(1)} fully blocked · ${printed(1)} actionable · ${printed(1)} with a QAE on it`,
    );
  });

  test('count what Task Wolf said nothing about, and a QAE who is on the customer only', () => {
    const totals = summarize([
      row({ flowIds: ['b1'], taskWolf: blocked({ blockedFlows: 1, customerAssignees: ['Rae'] }) }),
      row({
        flowIds: ['a1', 'a2', 'a3'],
        taskWolf: actionable({ actionableFlows: 1, unlistedFlows: 2 }),
      }),
      row({ flowIds: ['u1'], taskWolf: null }),
    ]);
    assert.equal(
      taskWolfFlowsLabel(totals),
      `${printed(1)} blocked on the customer · ${printed(1)} actionable · ${printed(3)} unknown`,
    );
    assert.equal(
      taskWolfReportsLabel(totals),
      `${printed(1)} fully blocked · ${printed(1)} actionable · ${printed(1)} unknown · ${printed(0)} with a QAE on it · ${printed(1)} more with a QAE on the customer`,
    );
  });
});

describe('taskWolfBadge', () => {
  test('"(n of m)" counts the flows listed as free, never the ones that are not blocked', () => {
    const partly = row({
      flowIds: ['f1', 'f2', 'f3', 'f4'],
      taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1, unlistedFlows: 2 }),
    });
    assert.deepEqual(taskWolfFlowSplit(partly), { blocked: 1, actionable: 1, unknown: 2 });
    assert.deepEqual(taskWolfBadge(partly), {
      verdict: 'actionable',
      label: '✓ Actionable (1 of 4)',
      title: '1 of 4 flows blocked · 2 not listed by Task Wolf',
    });

    const unlisted = row({
      flowIds: ['f1', 'f2', 'f3'],
      taskWolf: actionable({ actionableFlows: 1, unlistedFlows: 2 }),
    });
    assert.equal(taskWolfBadge(unlisted).label, '✓ Actionable (1 of 3)');
    assert.equal(taskWolfBadge(unlisted).title, '2 not listed by Task Wolf');

    const partlyBlocked = row({
      flowIds: ['f1', 'f2', 'f3'],
      taskWolf: actionable({ blockedFlows: 2, actionableFlows: 1 }),
    });
    assert.equal(taskWolfBadge(partlyBlocked).label, '✓ Actionable (1 of 3)');
    assert.equal(taskWolfBadge(partlyBlocked).title, '2 of 3 flows blocked');
  });

  test('a row with every flow free carries no count', () => {
    const free = row({ flowIds: ['f1', 'f2'], taskWolf: actionable({ actionableFlows: 2 }) });
    assert.deepEqual(taskWolfFlowSplit(free), { blocked: 0, actionable: 2, unknown: 0 });
    assert.deepEqual(taskWolfBadge(free), {
      verdict: 'actionable',
      label: '✓ Actionable',
      title: 'No active blocker',
    });
  });

  test('a row the customer-wide count decided says so, and claims no free flow', () => {
    const customerWide = row({
      flowIds: ['f1', 'f2'],
      taskWolf: actionable({ unlistedFlows: 2 }),
    });
    assert.deepEqual(taskWolfFlowSplit(customerWide), { blocked: 0, actionable: 0, unknown: 2 });
    assert.deepEqual(taskWolfBadge(customerWide), {
      verdict: 'actionable',
      label: '✓ Actionable',
      title:
        'Task Wolf has no blocked flows for this customer; none of this report’s 2 flows were listed',
    });
    const oneFlow = row({ flowIds: ['f1'], taskWolf: actionable({ unlistedFlows: 1 }) });
    assert.equal(
      taskWolfBadge(oneFlow).title,
      'Task Wolf has no blocked flows for this customer; this report’s one flow was not listed',
    );
  });

  test('a row the customer-wide count decided in the scan names its flows as not listed', () => {
    // Task Wolf lists both of the customer's flows as free, in full; the
    // report parks two flows from another id space.
    const customerTw = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({
        total: 2,
        items: [
          { flowId: 'f1', blocked: false },
          { flowId: 'f2', blocked: false },
        ],
      }),
    });
    const elsewhere = annotateReport(row({ flowIds: ['x1', 'x2'] }), customerTw);
    assert.equal(taskWolfBadge(elsewhere).verdict, 'actionable');
    assert.equal(
      taskWolfBadge(elsewhere).title,
      'Task Wolf has no blocked flows for this customer; none of this report’s 2 flows were listed',
    );
    // What the tooltip says is what the tiles count.
    assert.equal(summarize([elsewhere]).unknownFlows, 2);
  });

  test('never counts more flows than the row parks, or fewer than none', () => {
    const split = (taskWolf) => taskWolfFlowSplit(row({ flowIds: ['f1', 'f2', 'f3'], taskWolf }));
    assert.deepEqual(split(actionable({ blockedFlows: 5, actionableFlows: 5 })), {
      blocked: 3,
      actionable: 0,
      unknown: 0,
    });
    assert.deepEqual(split(actionable({ blockedFlows: 1, actionableFlows: 9 })), {
      blocked: 1,
      actionable: 2,
      unknown: 0,
    });
    assert.deepEqual(split(actionable({ blockedFlows: -2, actionableFlows: -1 })), {
      blocked: 0,
      actionable: 0,
      unknown: 3,
    });
    assert.equal(
      taskWolfBadge(
        row({
          flowIds: ['f1', 'f2', 'f3'],
          taskWolf: actionable({ blockedFlows: 1, actionableFlows: 9 }),
        }),
      ).label,
      '✓ Actionable (2 of 3)',
    );
  });

  test('a snapshot from before the verdict fields counts what is not blocked', () => {
    const older = row({ flowIds: ['f1', 'f2', 'f3'], taskWolf: olderVerdict(false, 1) });
    assert.deepEqual(taskWolfFlowSplit(older), { blocked: 1, actionable: 2, unknown: 0 });
    assert.equal(taskWolfBadge(older).label, '✓ Actionable (2 of 3)');
    assert.equal(taskWolfBadge(older).title, '1 of 3 flows blocked');
  });

  test('a blocked row shows its blocker', () => {
    const stuck = row({ flowIds: ['f1', 'f2'], taskWolf: blocked({ blockedFlows: 2 }) });
    assert.deepEqual(taskWolfFlowSplit(stuck), { blocked: 2, actionable: 0, unknown: 0 });
    assert.deepEqual(taskWolfBadge(stuck), {
      verdict: 'blocked',
      label: '⛔ Blocked',
      title: 'Waiting on staging credentials',
    });
    const untitled = row({ taskWolf: blocked({ blockerTitle: '' }) });
    assert.equal(taskWolfBadge(untitled).title, 'Blocked in Task Wolf');
  });

  test('an unknown row says what Task Wolf left out', () => {
    const silent = row({ flowIds: ['f1', 'f2'], taskWolf: null });
    assert.deepEqual(taskWolfFlowSplit(silent), { blocked: 0, actionable: 0, unknown: 2 });
    assert.deepEqual(taskWolfBadge(silent), {
      verdict: 'unknown',
      label: '—',
      title: 'Task Wolf gave no blocked status that ties to this report',
    });
    const unlisted = row({
      flowIds: ['f1', 'f2', 'f3'],
      taskWolf: unknown({ unlistedFlows: 3 }),
    });
    assert.equal(
      taskWolfBadge(unlisted).title,
      'Task Wolf did not list 3 of 3 flows on this report',
    );
    const cutShort = row({
      flowIds: ['f1', 'f2', 'f3'],
      taskWolf: unknown({ unlistedFlows: 3, partial: true }),
    });
    assert.equal(
      taskWolfBadge(cutShort).title,
      'Task Wolf cut its list short for this customer and left out 3 of 3 flows on this report',
    );
  });

  test('an unknown row names the flows Task Wolf listed as blocked', () => {
    const partlyBlocked = row({
      flowIds: ['f1', 'f2', 'f3'],
      taskWolf: unknown({ blockedFlows: 1, unlistedFlows: 2 }),
    });
    assert.deepEqual(taskWolfFlowSplit(partlyBlocked), { blocked: 1, actionable: 0, unknown: 2 });
    assert.deepEqual(taskWolfBadge(partlyBlocked), {
      verdict: 'unknown',
      label: '—',
      title: '1 of 3 flows blocked · Task Wolf did not list 2 of 3 flows on this report',
    });
  });
});

describe('taskWolfAssignees and taskWolfQae', () => {
  const both = row({
    taskWolf: actionable({
      actionableFlows: 1,
      assignees: ['Kalley'],
      customerAssignees: ['Rae', 'Kalley'],
    }),
  });
  const customerOnly = row({
    taskWolf: blocked({ blockedFlows: 1, customerAssignees: ['Rae', 'Sam'] }),
  });

  test('gives the report’s own QAEs and the customer’s as two lists', () => {
    assert.deepEqual(taskWolfAssignees(both), { own: ['Kalley'], customer: ['Rae', 'Kalley'] });
    assert.deepEqual(taskWolfAssignees(customerOnly), { own: [], customer: ['Rae', 'Sam'] });
    for (const nobody of [row(), row({ taskWolf: olderVerdict(null) }), null, undefined]) {
      assert.deepEqual(taskWolfAssignees(nobody), { own: [], customer: [] });
    }
    // Before the split the one list held both; it still reads as the report's.
    const older = row({ taskWolf: { ...olderVerdict(false), assignees: ['Kalley'] } });
    assert.deepEqual(taskWolfAssignees(older), { own: ['Kalley'], customer: [] });
  });

  test('names a QAE on the customer as such, and only when the report has none', () => {
    assert.deepEqual(taskWolfQae(both), {
      scope: 'report',
      text: 'QAE Kalley',
      title: 'QAE assigned to a flow this report parks',
    });
    assert.deepEqual(taskWolfQae(customerOnly), {
      scope: 'customer',
      text: 'QAE on customer: Rae, Sam',
      title: 'Has an open maintenance task for this customer, not necessarily this report',
    });
    assert.equal(taskWolfQae(row()), null);
  });
});

describe('taskWolfBlockedLabel', () => {
  test('gives the count, and nothing for none', () => {
    assert.equal(taskWolfBlockedLabel({ blockedFlows: 3, actionableFlows: 1 }), '3 blocked');
    assert.equal(taskWolfBlockedLabel({ blockedFlows: 0, actionableFlows: 4 }), '');
    assert.equal(taskWolfBlockedLabel({ blockedFlows: null, actionableFlows: null }), '');
    assert.equal(taskWolfBlockedLabel(null), '');
    assert.equal(taskWolfBlockedLabel(undefined), '');
  });

  test('says a count from a list cut short is a floor', () => {
    assert.equal(
      taskWolfBlockedLabel({ blockedFlows: 10, actionableFlows: null, partial: true }),
      'at least 10 blocked',
    );
    // A floor of zero arrives as null: the flows left out could be blocked.
    assert.equal(
      taskWolfBlockedLabel({ blockedFlows: null, actionableFlows: 2, partial: true }),
      'blocked unknown',
    );
  });
});

describe('customerReportsLabel', () => {
  test('counts the reports, and words one as one', () => {
    assert.equal(customerReportsLabel(customer({ openReports: 1 })), '1 report');
    assert.equal(customerReportsLabel(customer({ openReports: 3 })), '3 reports');
    assert.equal(customerReportsLabel(customer({ openReports: 1200 })), `${printed(1200)} reports`);
    assert.equal(customerReportsLabel(customer({ reportsTruncated: false })), '1 report');
  });

  test('marks the count "+" where QA Wolf has more reports than the scan read', () => {
    assert.equal(
      customerReportsLabel(customer({ openReports: 5000, reportsTruncated: true })),
      `${printed(5000)}+ reports`,
    );
    // One or more is plural.
    assert.equal(customerReportsLabel(customer({ reportsTruncated: true })), '1+ reports');
  });
});

describe('the culprit row of a customer whose reports were cut short', () => {
  test('marks every number "+" alike, and none without the flag', () => {
    const cutShort = customer({
      openReports: 5000,
      flowsInMaintenance: 7200,
      oldestReportAgeDays: 1400,
      reportsTruncated: true,
    });
    assert.equal(floorMark(cutShort), '+');
    assert.equal(customerReportsLabel(cutShort), `${printed(5000)}+ reports`);
    assert.equal(customerOldestLabel(cutShort), `oldest ${printed(1400)}+ d`);

    const whole = customer({ oldestReportAgeDays: 40 });
    assert.equal(floorMark(whole), '');
    assert.equal(floorMark(customer({ reportsTruncated: false })), '');
    assert.equal(customerReportsLabel(whole), '1 report');
    assert.equal(customerOldestLabel(whole), 'oldest 40 d');
  });
});

describe('describeTruncatedWorkspaces', () => {
  test('says nothing when no workspace was cut short, or the field is missing', () => {
    assert.equal(describeTruncatedWorkspaces([]), '');
    assert.equal(describeTruncatedWorkspaces(undefined), '');
    assert.equal(describeTruncatedWorkspaces(null), '');
  });

  test('names one workspace, how many were read, and what that means for its counts and age', () => {
    assert.equal(
      describeTruncatedWorkspaces([
        { workspaceId: 'ws-acme', workspaceName: 'Acme', reportsRead: 5000 },
      ]),
      `QA Wolf has more open maintenance reports than the scan reads in Acme (${printed(5000)} read). Its other reports are not listed, so its counts and oldest age below are lower bounds, marked "+" among the culprits.`,
    );
  });

  test('counts and names several, each on one line, by id when it has no name', () => {
    assert.equal(
      describeTruncatedWorkspaces([
        { workspaceId: 'ws-acme', workspaceName: 'Acme\n  Corp', reportsRead: 5000 },
        { workspaceId: 'ws-globex', workspaceName: '', reportsRead: 4990 },
      ]),
      `QA Wolf has more open maintenance reports than the scan reads in 2 workspaces: Acme Corp (${printed(5000)} read), ws-globex (${printed(4990)} read). Their other reports are not listed, so their counts and oldest ages below are lower bounds, marked "+" among the culprits.`,
    );
  });
});

describe('taskWolfNotFoundLevel', () => {
  const pass = (fields) => ({
    enabled: true,
    pending: false,
    error: null,
    customersQueried: 150,
    ...fields,
  });

  test('a few former customers are a hint, and none is nothing', () => {
    assert.equal(taskWolfNotFoundLevel(pass({ customersNotInTaskWolf: 40 })), 'hint');
    assert.equal(
      taskWolfNotFoundLevel(pass({ customersQueried: 1, customersNotInTaskWolf: 1 })),
      'hint',
    );
    assert.equal(taskWolfNotFoundLevel(pass({ customersNotInTaskWolf: 0 })), null);
    assert.equal(taskWolfNotFoundLevel(pass({ customersNotInTaskWolf: undefined })), null);
    assert.equal(taskWolfNotFoundLevel(pass({ pending: true, customersNotInTaskWolf: 40 })), null);
    assert.equal(taskWolfNotFoundLevel({ enabled: false, customersNotInTaskWolf: 40 }), null);
    assert.equal(taskWolfNotFoundLevel(null), null);
  });

  test('most of those asked is a warning, even with one answered and no error', () => {
    assert.equal(taskWolfNotFoundLevel(pass({ customersNotInTaskWolf: 149 })), 'warning');
    assert.equal(taskWolfNotFoundLevel(pass({ customersNotInTaskWolf: 76 })), 'warning');
    assert.equal(taskWolfNotFoundLevel(pass({ customersNotInTaskWolf: 75 })), 'hint');
    // An error that says nothing of it leaves it to be said.
    assert.equal(
      taskWolfNotFoundLevel(
        pass({ customersNotInTaskWolf: 120, error: { code: 'TW_AUTH', message: 'expired' } }),
      ),
      'warning',
    );
  });

  test('says nothing when the pass stopped because it knew no one, and its error says so', () => {
    const stopped = { code: 'TW_ABORTED', message: 'Task Wolf has no record of any of the 150…' };
    assert.equal(
      taskWolfNotFoundLevel(pass({ customersNotInTaskWolf: 150, error: stopped })),
      null,
    );
    // Stopped for want of any answer from the rest: those it has no record of are still a hint.
    assert.equal(
      taskWolfNotFoundLevel(
        pass({ customersQueried: 5, customersNotInTaskWolf: 2, error: { code: 'TW_ABORTED' } }),
      ),
      'hint',
    );
  });
});

describe('formatCalendarDay', () => {
  test('prints the day named wherever the viewer is, as the page prints any date', () => {
    // Held against local noon of the same day put through the page's own
    // formatter, so the locale does not matter; UTC midnight read as local
    // time would be the 11th in the Americas.
    const sameDayAsPage = (day, [year, month, date]) =>
      formatCalendarDay(day) === formatDate(new Date(year, month - 1, date, 12));
    for (const timeZone of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
      inTimeZone(timeZone, () => {
        assert.ok(sameDayAsPage('2026-10-12', [2026, 10, 12]), timeZone);
        assert.ok(!sameDayAsPage('2026-10-12', [2026, 10, 11]), timeZone);
        assert.ok(sameDayAsPage('2028-02-29', [2028, 2, 29]), timeZone);
      });
    }
  });

  test('prints nothing for anything but a real YYYY-MM-DD', () => {
    for (const day of [
      null,
      undefined,
      '',
      'soon',
      '2026-10-12T00:00:00Z',
      '2026-13-01',
      '2026-02-30',
      20261012,
    ]) {
      assert.equal(formatCalendarDay(day), '', String(day));
    }
  });
});

describe('describeTaskWolfTokenExpiry', () => {
  const day = formatCalendarDay('2026-10-12');
  const token = (state, daysLeft) => ({ expiresOn: '2026-10-12', daysLeft, state });
  const pass = (error = null) => ({ enabled: true, pending: false, error });

  test('says when a token that is expiring runs out, counting the days to it', () => {
    assert.equal(
      describeTaskWolfTokenExpiry(token('expiring', 14), pass()),
      `The Task Wolf token expires on ${day} (in 14 days).`,
    );
    assert.equal(
      describeTaskWolfTokenExpiry(token('expiring', 2), pass()),
      `The Task Wolf token expires on ${day} (in 2 days).`,
    );
    assert.equal(
      describeTaskWolfTokenExpiry(token('expiring', 1), pass()),
      `The Task Wolf token expires on ${day} (tomorrow).`,
    );
    // The token works through its last day, so on it the token is not yet expired.
    assert.equal(
      describeTaskWolfTokenExpiry(token('expiring', 0), pass()),
      `The Task Wolf token expires on ${day} (today).`,
    );
  });

  test('says when an expired token ran out', () => {
    assert.equal(
      describeTaskWolfTokenExpiry(token('expired', -1), pass()),
      `The Task Wolf token expired on ${day}.`,
    );
    assert.equal(
      describeTaskWolfTokenExpiry(token('expired', -30), null),
      `The Task Wolf token expired on ${day}.`,
    );
  });

  test('says nothing with time to spare, no date, or a date the server could not read', () => {
    assert.equal(describeTaskWolfTokenExpiry(token('ok', 15), pass()), '');
    assert.equal(
      describeTaskWolfTokenExpiry({ expiresOn: null, daysLeft: null, state: 'invalid' }, pass()),
      '',
    );
    assert.equal(describeTaskWolfTokenExpiry(null, pass()), '');
    assert.equal(describeTaskWolfTokenExpiry(undefined, undefined), '');
    // An expiring token without its count of days is not guessed at.
    assert.equal(describeTaskWolfTokenExpiry(token('expiring', null), pass()), '');
  });

  test('leaves it to the notice that Task Wolf rejected the token, and to no other failure', () => {
    const rejected = pass({ code: 'TW_AUTH', message: 'invalid or expired' });
    assert.equal(describeTaskWolfTokenExpiry(token('expired', -1), rejected), '');
    assert.equal(describeTaskWolfTokenExpiry(token('expiring', 3), rejected), '');
    const stopped = pass({ code: 'TW_ABORTED', message: 'Task Wolf stopped answering.' });
    assert.equal(
      describeTaskWolfTokenExpiry(token('expired', -1), stopped),
      `The Task Wolf token expired on ${day}.`,
    );
    assert.equal(
      describeTaskWolfTokenExpiry(token('expiring', 3), { ...pass(), pending: true }),
      `The Task Wolf token expires on ${day} (in 3 days).`,
    );
  });
});

describe('the rows the scan publishes', () => {
  // Task Wolf lists f1 as blocked and f2 as free with Kalley on it; its list
  // stops there, one short of the three it counts. Rae has a task for the
  // customer.
  const customerTw = summarizeTaskWolfCustomer({
    maintenance: normalizeMaintenanceStatus({
      total: 3,
      items: [
        { flowId: 'f1', blocked: true, blocker: { title: 'Staging down' } },
        { flowId: 'f2', blocked: false, assignee: 'Kalley' },
      ],
    }),
    tasks: normalizeTasks({
      tasks: [{ id: 't1', type: 'maintenance', status: 'open', assignee: 'Rae' }],
    }),
  });
  const mixed = annotateReport(row({ flowIds: ['f1', 'f2', 'f3'] }), customerTw);
  const stuck = annotateReport(row({ flowIds: ['f1'] }), customerTw);
  const unlisted = annotateReport(row({ flowIds: ['f3', 'f4'] }), customerTw);

  test('are read field for field', () => {
    assert.deepEqual(
      [mixed, stuck, unlisted].map((r) => taskWolfBadge(r).verdict),
      ['actionable', 'blocked', 'unknown'],
    );
    assert.equal(taskWolfBadge(mixed).label, '✓ Actionable (1 of 3)');
    assert.equal(taskWolfBadge(stuck).title, 'Staging down');
    assert.match(taskWolfBadge(unlisted).title, /cut its list short .* 2 of 2 flows/);
    assert.deepEqual(taskWolfAssignees(mixed), { own: ['Kalley'], customer: ['Rae'] });
    assert.deepEqual(taskWolfAssignees(stuck), { own: [], customer: ['Rae'] });

    const totals = summarize([mixed, stuck, unlisted]);
    assert.equal(totals.flows, 4);
    assert.equal(totals.blockedFlows, 1);
    assert.equal(totals.actionableFlows, 1);
    assert.equal(totals.unknownFlows, 2);
    assert.equal(totals.withQae, 1);
    assert.equal(totals.withCustomerQae, 2);
  });

  test('have a customer whose blocked count is a floor', () => {
    assert.equal(customerTw.partial, true);
    assert.equal(taskWolfBlockedLabel(customerTw), 'at least 1 blocked');
  });
});

describe('the rows of a customer whose list Task Wolf cut short', () => {
  // Task Wolf counts 20 flows and lists four: b1, b2 and b3 blocked, a1 free.
  // Two reports park listed blocked flows beside ones it left out.
  const customerTw = summarizeTaskWolfCustomer({
    maintenance: normalizeMaintenanceStatus({
      total: 20,
      items: [
        ...['b1', 'b2', 'b3'].map((flowId) => ({
          flowId,
          blocked: true,
          blocker: { title: 'Staging down' },
        })),
        { flowId: 'a1', blocked: false },
      ],
    }),
  });
  const bolt = (flowIds, ageDays) =>
    annotateReport(
      row({ flowIds, ageDays, workspaceId: 'ws-bolt', workspaceName: 'Bolt' }),
      customerTw,
    );
  const rows = [bolt(['b1', 'b2', 'x1'], 30), bolt(['b3', 'x2'], 20), bolt(['a1'], 10)];
  const entry = customer({ workspaceId: 'ws-bolt', name: 'Bolt', taskWolf: customerTw });

  test('count the flows it listed as blocked, as the culprit panel does', () => {
    assert.equal(customerTw.partial, true);
    assert.deepEqual(
      rows.map((r) => taskWolfBadge(r).verdict),
      ['unknown', 'unknown', 'actionable'],
    );
    const totals = summarize(rows);
    assert.deepEqual(
      [totals.flows, totals.blockedFlows, totals.actionableFlows, totals.unknownFlows],
      [6, 3, 1, 2],
    );
    assert.equal(
      taskWolfFlowsLabel(totals),
      `${printed(3)} blocked on the customer · ${printed(1)} actionable · ${printed(2)} unknown`,
    );
    assert.equal(taskWolfBlockedLabel(entry.taskWolf), 'at least 3 blocked');

    const lines = slackSummary({ reports: rows, customers: [entry] }).split('\n');
    assert.ok(
      lines[0].endsWith(' Task Wolf: 3 blocked on the customer, 1 actionable, 2 unknown.'),
      lines[0],
    );
    assert.equal(lines[2], '• Bolt — 6 flows across 3 reports (oldest 30 d) · at least 3 blocked');
  });

  test('still say what Task Wolf listed when every row on screen is unknown', () => {
    const unknownRows = rows.slice(0, 2);
    const totals = summarize(unknownRows);
    assert.equal(totals.unknownReports, 2);
    assert.ok(totals.withTaskWolf > 0);
    assert.equal(
      taskWolfFlowsLabel(totals),
      `${printed(3)} blocked on the customer · ${printed(0)} actionable · ${printed(2)} unknown`,
    );
    const headline = slackSummary({ reports: unknownRows, customers: [entry] }).split('\n')[0];
    assert.ok(
      headline.endsWith(' Task Wolf: 3 blocked on the customer, 0 actionable, 2 unknown.'),
      headline,
    );
  });

  test('say "at least" only while one of the customer’s flows on screen is unknown', () => {
    const culprit = (reports) => slackSummary({ reports, customers: [entry] }).split('\n')[2];
    // b1 and b2 are listed blocked and a1 free: nothing on screen is unknown.
    assert.equal(
      culprit([bolt(['b1', 'b2'], 30), rows[2]]),
      '• Bolt — 3 flows across 2 reports (oldest 30 d) · 2 blocked',
    );
    // x2 was left out of the list: it could be blocked too.
    assert.equal(
      culprit([bolt(['b1', 'b2'], 30), rows[1]]),
      '• Bolt — 4 flows across 2 reports (oldest 30 d) · at least 3 blocked',
    );
  });

  test('name the blocked flows on the badge of an unknown row', () => {
    assert.equal(
      taskWolfBadge(rows[0]).title,
      '2 of 3 flows blocked · Task Wolf cut its list short for this customer and left out 1 of 3 flows on this report',
    );
  });
});

describe('the rows of a customer whose list Task Wolf gave in full', () => {
  // Task Wolf lists every flow it counts, but one of the reports' flows (the
  // unlisted one) is not among them: another id space.
  const flowsOf = (unlisted) => {
    const [blockedId, freeId, otherFreeId] = ['f1', 'f2', 'f3', 'f4'].filter(
      (id) => id !== unlisted,
    );
    return { blockedId, freeId, otherFreeId };
  };
  const rowsFor = (unlisted) => {
    const { blockedId, freeId, otherFreeId } = flowsOf(unlisted);
    const customerTw = summarizeTaskWolfCustomer({
      maintenance: normalizeMaintenanceStatus({
        total: 3,
        items: [
          { flowId: blockedId, blocked: true, blocker: { title: 'creds' } },
          { flowId: freeId, blocked: false },
          { flowId: otherFreeId, blocked: false },
        ],
      }),
    });
    return [
      [blockedId, freeId, unlisted], // actionable: one blocked, one free, one unlisted
      [unlisted], // unknown: nothing listed
      [blockedId, otherFreeId], // actionable: one blocked, one free
    ].map((flowIds) => annotateReport(row({ flowIds }), customerTw));
  };

  test('split the same, in any order, whichever of the flows was left out', () => {
    // f3 left out sorts after the others by id, f1 before them.
    for (const unlisted of ['f3', 'f1']) {
      const rows = rowsFor(unlisted);
      assert.deepEqual(
        rows.map((r) => taskWolfBadge(r).verdict),
        ['actionable', 'unknown', 'actionable'],
      );
      for (const order of permutations(rows)) {
        const totals = summarize(order);
        assert.deepEqual(
          [totals.flows, totals.blockedFlows, totals.actionableFlows, totals.unknownFlows],
          [4, 1, 2, 1],
          `${unlisted} left out: ${order.map((r) => r.flowIds.join('+')).join(', ')}`,
        );
      }
    }
  });
});

describe('the rows of a customer whose list names each flow', () => {
  // Task Wolf lists f1 as free and f2 as blocked, in full, and says nothing of
  // f0. Two actionable reports both park f1 and f2.
  const customerTw = summarizeTaskWolfCustomer({
    maintenance: normalizeMaintenanceStatus({
      total: 2,
      items: [
        { flowId: 'f1', blocked: false },
        { flowId: 'f2', blocked: true, blocker: { title: 'creds' } },
      ],
    }),
  });
  const rows = [
    ['f1', 'f0', 'f2'],
    ['f1', 'f2'],
  ].map((flowIds) => annotateReport(row({ flowIds }), customerTw));
  const entry = customer({ taskWolf: customerTw });
  const split = (totals) => [
    totals.flows,
    totals.blockedFlows,
    totals.actionableFlows,
    totals.unknownFlows,
  ];

  test('count a flow two actionable reports share as Task Wolf listed it, in any order', () => {
    assert.equal(customerTw.partial, false);
    assert.deepEqual(
      rows.map((r) => taskWolfBadge(r).verdict),
      ['actionable', 'actionable'],
    );
    for (const order of permutations(rows)) assert.deepEqual(split(summarize(order)), [3, 1, 1, 1]);
    // The tile and the Slack digest agree with the customer's own count.
    assert.equal(taskWolfBlockedLabel(entry.taskWolf), '1 blocked');
    const lines = slackSummary({ reports: rows, customers: [entry] }).split('\n');
    assert.ok(
      lines[0].endsWith(' Task Wolf: 1 blocked on the customer, 1 actionable, 1 unknown.'),
      lines[0],
    );
    assert.equal(lines[2], '• Acme — 3 flows across 2 reports (oldest 10 d) · 1 blocked');
  });

  test('decide each flow from the lists where the counts could only guess which', () => {
    // Both rows count one blocked flow, and it is the same one: y.
    const rows = [
      row({
        flowIds: ['x', 'y'],
        taskWolf: actionable({
          blockedFlows: 1,
          actionableFlows: 1,
          blockedFlowIds: ['y'],
          freeFlowIds: ['x'],
        }),
      }),
      row({
        flowIds: ['y', 'z'],
        taskWolf: actionable({
          blockedFlows: 1,
          actionableFlows: 1,
          blockedFlowIds: ['y'],
          freeFlowIds: ['z'],
        }),
      }),
    ];
    for (const order of permutations(rows)) assert.deepEqual(split(summarize(order)), [3, 1, 2, 0]);
  });

  test('a row without the lists puts its blocked count on a flow the lists call blocked', () => {
    const rows = [
      // From a snapshot before the lists: one of x and y is blocked.
      row({ flowIds: ['x', 'y'], taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1 }) }),
      row({
        flowIds: ['y', 'z'],
        taskWolf: actionable({
          blockedFlows: 1,
          actionableFlows: 1,
          blockedFlowIds: ['y'],
          freeFlowIds: ['z'],
        }),
      }),
    ];
    for (const order of permutations(rows)) assert.deepEqual(split(summarize(order)), [3, 1, 2, 0]);
  });

  test('on a flow two rows disagree on, blocked wins over unknown wins over actionable', () => {
    const lists = (blockedFlowIds, freeFlowIds) => ({ blockedFlowIds, freeFlowIds });
    const rows = [
      // Decided by the customer-wide count: every flow blocked, none listed.
      row({ flowIds: ['s1', 's2'], taskWolf: blocked({ unlistedFlows: 2, ...lists([], []) }) }),
      row({
        flowIds: ['s1', 's3', 'a1'],
        taskWolf: actionable({ actionableFlows: 3, ...lists([], ['s1', 's3', 'a1']) }),
      }),
      row({ flowIds: ['s3'], taskWolf: null }),
      row({ flowIds: ['s2', 'u1'], taskWolf: unknown({ unlistedFlows: 2, ...lists([], []) }) }),
    ];
    for (const order of permutations(rows)) {
      // s1 and s2 blocked, s3 and u1 unknown, a1 actionable.
      assert.deepEqual(split(summarize(order)), [5, 2, 1, 2]);
    }
  });
});

describe('the rows of a customer whose flow counts Task Wolf never gave', () => {
  // find_tasks answered and get_maintenance_status did not: nothing was said
  // of any flow, so the report's three counts are null.
  const customerTw = summarizeTaskWolfCustomer({
    tasks: normalizeTasks({
      tasks: [{ id: 't1', type: 'maintenance', status: 'open', assignee: 'Rae' }],
    }),
  });
  const tasksOnly = annotateReport(row({ flowIds: ['f1', 'f2', 'f3'] }), customerTw);
  const nothingSaid = /null|undefined|NaN/;

  test('are unknown, every flow of them, and no label prints a null', () => {
    assert.deepEqual(
      [tasksOnly.taskWolf.blockedFlows, tasksOnly.taskWolf.actionableFlows],
      [null, null],
    );
    assert.deepEqual(taskWolfFlowSplit(tasksOnly), { blocked: 0, actionable: 0, unknown: 3 });
    assert.deepEqual(taskWolfBadge(tasksOnly), {
      verdict: 'unknown',
      label: '—',
      title: 'Task Wolf gave no blocked status that ties to this report',
    });
    const totals = summarize([tasksOnly]);
    assert.deepEqual(
      [totals.flows, totals.blockedFlows, totals.actionableFlows, totals.unknownFlows],
      [3, 0, 0, 3],
    );
    assert.equal(totals.withTaskWolf, 0);
    assert.equal(totals.withCustomerQae, 1);
    const text = slackSummary({ reports: [tasksOnly], customers: [customer()] });
    assert.ok(!text.split('\n')[0].includes('Task Wolf'), text);
    assert.equal(
      text.split('\n')[2],
      '• Acme — 3 flows across 1 report (oldest 10 d) · customer QAE Rae',
    );
    assert.ok(!nothingSaid.test(text), text);
    assert.ok(!nothingSaid.test(reportsToCsv([tasksOnly])));
  });

  test('beside a row whose counts Task Wolf gave, add nothing but unknown flows', () => {
    const counted = row({ flowIds: ['b1'], taskWolf: blocked({ blockedFlows: 1 }) });
    const totals = summarize([counted, tasksOnly]);
    assert.deepEqual(
      [totals.flows, totals.blockedFlows, totals.actionableFlows, totals.unknownFlows],
      [4, 1, 0, 3],
    );
    assert.equal(
      taskWolfFlowsLabel(totals),
      `${printed(1)} blocked on the customer · ${printed(0)} actionable · ${printed(3)} unknown`,
    );
  });

  test('a null count on an actionable row counts none of its flows as free', () => {
    const nulls = row({
      flowIds: ['f1', 'f2', 'f3'],
      taskWolf: actionable({ blockedFlows: null, actionableFlows: null, unlistedFlows: null }),
    });
    assert.deepEqual(taskWolfFlowSplit(nulls), { blocked: 0, actionable: 0, unknown: 3 });
    const totals = summarize([nulls]);
    assert.deepEqual([totals.actionableFlows, totals.unknownFlows], [0, 3]);
    const badge = taskWolfBadge(nulls);
    assert.equal(badge.label, '✓ Actionable');
    assert.ok(!nothingSaid.test(badge.title) && !/\b0\b/.test(badge.title), badge.title);
    // A count Task Wolf did give still counts, beside the null one.
    const halfNull = row({
      flowIds: ['f1', 'f2', 'f3'],
      taskWolf: actionable({ blockedFlows: null, actionableFlows: 2, unlistedFlows: null }),
    });
    assert.deepEqual(taskWolfFlowSplit(halfNull), { blocked: 0, actionable: 2, unknown: 1 });
    assert.equal(taskWolfBadge(halfNull).label, '✓ Actionable (2 of 3)');
    assert.equal(taskWolfBadge(halfNull).title, '1 not listed by Task Wolf');
  });
});

describe('filterReports: Task Wolf filter', () => {
  const rows = [
    row({ issueId: 'free', taskWolf: actionable() }),
    row({ issueId: 'stuck', taskWolf: blocked() }),
    row({ issueId: 'silent', taskWolf: null }),
    row({ issueId: 'untied', taskWolf: unknown() }),
  ];
  const ids = (taskWolf) =>
    filterReports(rows, { taskWolf })
      .map((r) => r.issueId)
      .sort();

  test('"actionable" keeps only the rows Task Wolf confirmed actionable', () => {
    assert.deepEqual(ids('actionable'), ['free']);
  });

  test('"blocked" keeps the blocked rows and "unknown" the ones with no verdict', () => {
    assert.deepEqual(ids('blocked'), ['stuck']);
    assert.deepEqual(ids('unknown'), ['silent', 'untied']);
  });

  test('"all" keeps everything', () => {
    assert.deepEqual(ids('all'), ['free', 'silent', 'stuck', 'untied']);
    assert.equal(filterReports(rows).length, 4);
  });
});

describe('filterCustomers: Task Wolf filter', () => {
  const customers = [
    customer({ name: 'Silent', taskWolf: null }),
    customer({
      name: 'Nulls',
      taskWolf: { blockedFlows: null, actionableFlows: null, flowsInMaintenance: null },
    }),
    customer({
      name: 'Free',
      taskWolf: { blockedFlows: 0, actionableFlows: 3, flowsInMaintenance: 3 },
    }),
    customer({
      name: 'Stuck',
      taskWolf: { blockedFlows: 4, actionableFlows: 0, flowsInMaintenance: 4 },
    }),
    customer({
      name: 'Mixed',
      taskWolf: { blockedFlows: 1, actionableFlows: 2, flowsInMaintenance: 3 },
    }),
    customer({
      name: 'Zeroes',
      taskWolf: { blockedFlows: 0, actionableFlows: 0, flowsInMaintenance: 0 },
    }),
    // The tasks call answered, the maintenance count is half there.
    customer({
      name: 'Half',
      taskWolf: { blockedFlows: 2, actionableFlows: null, flowsInMaintenance: null },
    }),
    // A list cut short: both counts are floors.
    customer({
      name: 'Floors',
      taskWolf: { blockedFlows: 3, actionableFlows: 1, flowsInMaintenance: 9, partial: true },
    }),
  ];
  const names = (taskWolf) => filterCustomers(customers, { taskWolf }).map((c) => c.name);

  test('"actionable" needs a count of free flows above zero', () => {
    assert.deepEqual(names('actionable'), ['Free', 'Mixed', 'Floors']);
  });

  test('"blocked" needs a count of blocked flows above zero', () => {
    assert.deepEqual(names('blocked'), ['Stuck', 'Mixed', 'Half', 'Floors']);
  });

  test('"unknown" keeps customers Task Wolf gave no full count for', () => {
    assert.deepEqual(names('unknown'), ['Silent', 'Nulls', 'Zeroes', 'Half', 'Floors']);
  });

  test('a customer counted 0 blocked and 0 actionable is unknown, not dropped', () => {
    assert.deepEqual(
      ['actionable', 'blocked', 'unknown'].filter((taskWolf) => names(taskWolf).includes('Zeroes')),
      ['unknown'],
    );
  });

  test('every customer is kept by at least one of the three', () => {
    const kept = new Set(['actionable', 'blocked', 'unknown'].flatMap(names));
    assert.deepEqual(
      customers.map((c) => c.name).filter((name) => !kept.has(name)),
      [],
    );
  });

  test('"all" keeps everyone, in order', () => {
    assert.deepEqual(names('all'), [
      'Silent',
      'Nulls',
      'Free',
      'Stuck',
      'Mixed',
      'Zeroes',
      'Half',
      'Floors',
    ]);
  });
});

describe('filterReports: search', () => {
  const rows = [
    row({ issueId: 'sso', number: 231, name: 'SSO login' }),
    row({ issueId: 'cart', number: 7, name: 'Cart total', workspaceName: 'Globex' }),
  ];
  const ids = (search) => filterReports(rows, { search }).map((r) => r.issueId);

  test('finds a report by its number, with or without the "#"', () => {
    assert.deepEqual(ids('231'), ['sso']);
    assert.deepEqual(ids('#231'), ['sso']);
    assert.deepEqual(ids('#7'), ['cart']);
  });

  test('finds a report by the label the page prints', () => {
    assert.deepEqual(ids('#231 sso login'), ['sso']);
    assert.deepEqual(ids('  #231   SSO  '), ['sso']);
  });

  test('still matches the name, the customer and the organization', () => {
    assert.deepEqual(ids('cart'), ['cart']);
    assert.deepEqual(ids('globex'), ['cart']);
    assert.deepEqual(ids('acme corp'), ['sso', 'cart']);
    assert.deepEqual(ids('#999'), []);
  });

  test('a search of "#" and a number finds that number whole, not a longer one', () => {
    const numbered = [231, 2310, 2311, 1231, null].map((number) =>
      row({ issueId: `n${number}`, number, name: 'SSO login' }),
    );
    const found = (search) => filterReports(numbered, { search }).map((r) => r.issueId);
    assert.deepEqual(found('#231'), ['n231']);
    assert.deepEqual(found(' #2310 '), ['n2310']);
    assert.deepEqual(found('#23'), []);
    // Without the "#" it is still a search of the text.
    assert.deepEqual(found('231'), ['n231', 'n2310', 'n2311', 'n1231']);
    // With more after the number it is still the printed label.
    assert.deepEqual(found('#231 sso login'), ['n231']);
    assert.deepEqual(found('#2310 sso'), ['n2310']);
  });
});

describe('search: whitespace', () => {
  // Names as customers typed them: a double space, a non-breaking space, a tab.
  const rows = [
    row({
      issueId: 'globex',
      workspaceId: 'ws-globex',
      workspaceName: 'Globex  Inc',
      organizationName: 'Globex Holdings\tLtd',
    }),
    row({ issueId: 'acme' }),
  ];
  const customers = [
    customer({
      workspaceId: 'ws-globex',
      name: 'Globex  Inc',
      organizationName: 'Globex Holdings\tLtd',
    }),
    customer(),
  ];
  const reportIds = (search) => filterReports(rows, { search }).map((r) => r.issueId);
  const customerIds = (search) => filterCustomers(customers, { search }).map((c) => c.workspaceId);

  test('a name stored with a run of whitespace is found by typing it', () => {
    for (const search of ['globex inc', 'globex  inc', '  GLOBEX \t INC ', 'holdings ltd']) {
      assert.deepEqual(reportIds(search), ['globex'], search);
      assert.deepEqual(customerIds(search), ['ws-globex'], search);
    }
  });

  test('a search typed with two spaces finds the same customer in both lists', () => {
    for (const search of ['acme  corp', ' acme  corp ']) {
      assert.deepEqual(reportIds(search), ['acme'], search);
      assert.deepEqual(customerIds(search), ['ws-acme'], search);
    }
  });

  test('a search of nothing but whitespace keeps everything', () => {
    assert.equal(reportIds(' \t ').length, 2);
    assert.equal(customerIds(' \t ').length, 2);
  });

  test('a row without a name or an organization does not break the search', () => {
    const bare = [row({ issueId: 'bare', workspaceName: undefined, organizationName: null })];
    assert.deepEqual(
      filterReports(bare, { search: 'sso' }).map((r) => r.issueId),
      ['bare'],
    );
    assert.deepEqual(filterReports(bare, { search: 'acme' }), []);
    assert.deepEqual(
      filterCustomers([customer({ name: undefined, organizationName: null })], { search: 'acme' }),
      [],
    );
  });
});

describe('customersWithVisibleReports', () => {
  test('keeps the customers that have a row in the table, in the order given', () => {
    const customers = [
      customer({ workspaceId: 'ws-globex', name: 'Globex' }),
      customer({ workspaceId: 'ws-initech', name: 'Initech' }),
      customer({ workspaceId: 'ws-acme', name: 'Acme' }),
    ];
    const rows = [row({ workspaceId: 'ws-acme' }), row({ workspaceId: 'ws-globex' })];
    assert.deepEqual(
      customersWithVisibleReports(customers, rows).map((c) => c.name),
      ['Globex', 'Acme'],
    );
    assert.deepEqual(customersWithVisibleReports(customers, []), []);
    assert.deepEqual(customersWithVisibleReports(undefined, undefined), []);
  });
});

describe('localIsoDate', () => {
  test('gives the calendar day where the viewer is, not the UTC one', () => {
    inTimeZone('America/Los_Angeles', () => {
      assert.equal(localIsoDate('2026-09-28T01:30:00.000Z'), '2026-09-27');
      assert.equal(localIsoDate(new Date('2026-09-28T01:30:00.000Z')), '2026-09-27');
      assert.equal(localIsoDate('2026-01-05T12:00:00.000Z'), '2026-01-05');
    });
    inTimeZone('Asia/Tokyo', () => {
      assert.equal(localIsoDate('2026-09-27T22:30:00.000Z'), '2026-09-28');
    });
  });

  test('defaults to today', () => {
    assert.match(localIsoDate(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(localIsoDate(), localIsoDate(new Date()));
  });

  test('gives nothing for a missing or unparseable date', () => {
    assert.equal(localIsoDate(null), '');
    assert.equal(localIsoDate(''), '');
    assert.equal(localIsoDate('not a date'), '');
  });
});

describe('reportsToCsv', () => {
  const HEADER = [
    'Customer',
    'Organization',
    'Report #',
    'Report',
    'Age (days)',
    'Flows parked',
    'Status',
    'Priority',
    'Created',
    'Task Wolf',
    'Blocker',
    'QAE on it',
    'QAE on customer',
    'URL',
  ];
  const HEADER_CELLS = HEADER.length;
  const CREATED = HEADER.indexOf('Created');

  test('starts with a byte-order mark, then the header', () => {
    const csv = reportsToCsv([row()]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.deepEqual(parseCsv(csv.slice(1))[0], HEADER);
  });

  test('writes the report’s own QAEs and the customer’s in columns of their own', () => {
    const csv = reportsToCsv([
      row({
        taskWolf: actionable({
          actionableFlows: 1,
          assignees: ['Kalley', 'Sam'],
          customerAssignees: ['Rae'],
        }),
      }),
      row({ taskWolf: blocked({ blockedFlows: 1, customerAssignees: ['Rae', 'Sam'] }) }),
      row({ taskWolf: null }),
    ]);
    const [, both, customerOnly, nobody] = parseCsv(csv.slice(1));
    const qae = (cells) => [
      cells[HEADER.indexOf('QAE on it')],
      cells[HEADER.indexOf('QAE on customer')],
    ];
    assert.deepEqual(qae(both), ['Kalley; Sam', 'Rae']);
    assert.deepEqual(qae(customerOnly), ['', 'Rae; Sam']);
    assert.deepEqual(qae(nobody), ['', '']);
    for (const cells of [both, customerOnly, nobody]) {
      assert.equal(cells.length, HEADER_CELLS);
      assert.equal(
        cells[HEADER.indexOf('URL')],
        'https://app.qawolf.com/acme/maintenance-reports/x',
      );
    }
  });

  test('defuses cells a sheet would run as a formula', () => {
    const csv = reportsToCsv([
      row({
        workspaceName: '=HYPERLINK("http://evil.test","x")',
        organizationName: '@SUM(1+1)',
        name: '+cmd|calc',
        taskWolf: blocked({
          blockerTitle: '-2+3',
          assignees: ['\tTab', '\rReturn'],
          customerAssignees: ['=cmd', 'Rae'],
        }),
      }),
    ]);
    const [, cells] = parseCsv(csv.slice(1));
    assert.equal(cells.length, HEADER_CELLS);
    assert.equal(cells[0], `'=HYPERLINK("http://evil.test","x")`);
    assert.equal(cells[1], `'@SUM(1+1)`);
    assert.equal(cells[3], `'+cmd|calc`);
    assert.equal(cells[10], `'-2+3`);
    assert.equal(cells[11], `'\tTab; \rReturn`);
    assert.equal(cells[12], `'=cmd; Rae`);
    // Quoted as well, so the apostrophe stays with its cell.
    assert.ok(csv.includes(`,"'@SUM(1+1)",`));
    assert.ok(csv.includes(`,"'+cmd|calc",`));
  });

  test('leaves the numbers the export writes, and plain signed numbers, alone', () => {
    const csv = reportsToCsv([
      row({ number: 231, ageDays: 120, flowIds: ['a', 'b', 'c'], priority: '-5', name: '+42' }),
    ]);
    const line = csv.slice(1).split('\n')[1];
    assert.ok(line.startsWith('Acme,Acme Corp,231,+42,120,3,In progress,-5,'), line);
  });

  test('quotes a carriage return so it cannot split the row', () => {
    const csv = reportsToCsv([row({ name: 'line one\rline two' }), row({ name: 'a "b", c\nd' })]);
    assert.ok(csv.includes('"line one\rline two"'));
    const records = parseCsv(csv.slice(1));
    assert.equal(records.length, 3);
    for (const record of records) assert.equal(record.length, HEADER_CELLS);
    assert.equal(records[1][3], 'line one\rline two');
    assert.equal(records[2][3], 'a "b", c\nd');
  });

  test('writes Created as the local date the page shows', () => {
    const created = (createdAt) =>
      parseCsv(reportsToCsv([row({ createdAt })]).slice(1))[1][CREATED];
    // The page words the date as the machine's locale does, so it is held
    // against the same day put through the page's own formatter: local noon
    // of the day in the CSV, and not of the day the UTC string names.
    const pageShows = (createdAt, [year, month, day]) =>
      formatDate(createdAt) === formatDate(new Date(year, month - 1, day, 12));

    inTimeZone('America/Los_Angeles', () => {
      const createdAt = '2026-09-28T01:30:00.000Z';
      assert.equal(created(createdAt), '2026-09-27');
      assert.ok(pageShows(createdAt, [2026, 9, 27]), formatDate(createdAt));
      assert.ok(!pageShows(createdAt, [2026, 9, 28]), formatDate(createdAt));
      assert.equal(created(new Date(createdAt).getTime()), '2026-09-27');
    });
    inTimeZone('Asia/Tokyo', () => {
      const createdAt = '2026-09-27T22:30:00.000Z';
      assert.equal(created(createdAt), '2026-09-28');
      assert.ok(pageShows(createdAt, [2026, 9, 28]), formatDate(createdAt));
      assert.ok(!pageShows(createdAt, [2026, 9, 27]), formatDate(createdAt));
    });
    inTimeZone('UTC', () => {
      assert.equal(created('2026-09-28T01:30:00.000Z'), '2026-09-28');
    });
    // No date, or one that cannot be read, is an empty cell where the page
    // shows a dash; it is never today's date.
    for (const createdAt of [null, undefined, '', 'not a date']) {
      assert.equal(created(createdAt), '', String(createdAt));
      assert.equal(formatDate(createdAt), '—');
    }
  });
});

describe('slackSummary', () => {
  const url = (slug) => `https://app.qawolf.com/${slug}/maintenance-reports/x`;

  test('writes each report as its label, then the bare URL on the same bullet', () => {
    const text = slackSummary({
      reports: [row({ number: 231, name: 'SSO login', ageDays: 120, url: url('acme') })],
      customers: [customer()],
    });
    assert.ok(text.includes(`• Acme — #231 SSO login ${url('acme')} · 120 d · 1 flow`), text);
    assert.ok(!/<[^>]*\|[^>]*>/.test(text), text);
    assert.ok(!text.includes('<http'), text);
  });

  test('a report without a URL is its label alone', () => {
    const text = slackSummary({ reports: [row({ number: null, url: null })], customers: [] });
    assert.ok(text.includes('• Acme — #? SSO login · 10 d'), text);
  });

  test('keeps a name with newlines or runs of spaces on one bullet', () => {
    const text = slackSummary({
      reports: [
        row({
          name: 'Checkout\nbroke   again\r\n',
          workspaceName: 'Acme\n Corp',
          taskWolf: blocked({ blockerTitle: 'Waiting\non  creds', assignees: ['Sam\nLee'] }),
        }),
      ],
      customers: [customer({ name: 'Acme\n Corp' })],
    });
    const lines = text.split('\n');
    assert.equal(lines.length, 5);
    assert.ok(lines[2].startsWith('• Acme Corp — 1 flow across 1 report'), lines[2]);
    assert.ok(lines[2].endsWith(' · 1 blocked · QAE Sam Lee'), lines[2]);
    assert.ok(lines[4].startsWith('• Acme Corp — #231 Checkout broke again https://'), lines[4]);
    assert.ok(lines[4].endsWith(' · blocked (Waiting on creds) · QAE Sam Lee'), lines[4]);
  });

  test('"Longest outstanding" is the oldest rows, whatever order the table is in', () => {
    // Of the two oldest, the table has the one with fewer flows first.
    const rows = [
      row({ name: 'Young', ageDays: 3, workspaceName: 'Aardvark' }),
      row({ name: 'Old, few flows', ageDays: 300, workspaceName: 'Yak' }),
      row({ name: 'Middling', ageDays: 30, workspaceName: 'Marmot' }),
      row({ name: 'Old, many flows', ageDays: 300, flowIds: ['x', 'y'], workspaceName: 'Zebra' }),
    ];
    const byCustomer = filterReports(rows, { sortKey: 'customer' });
    assert.deepEqual(
      byCustomer.map((r) => r.name),
      ['Young', 'Middling', 'Old, few flows', 'Old, many flows'],
    );
    const text = slackSummary({ reports: byCustomer, customers: [], topN: 3 });
    const bullets = text.slice(text.indexOf('*Longest outstanding*')).split('\n').slice(1);
    assert.deepEqual(
      bullets.map((line) => line.match(/#231 (.*?) https/)[1]),
      ['Old, many flows', 'Old, few flows', 'Middling'],
    );
    // The caller's rows are left in the order the table shows them.
    assert.equal(byCustomer[0].name, 'Young');
  });

  test('of two reports as old as each other, the one parking more flows comes first', () => {
    const few = row({ name: 'Few', ageDays: 90, flowIds: ['f1'] });
    const many = row({ name: 'Many', ageDays: 90, flowIds: ['m1', 'm2', 'm3'] });
    const older = row({ name: 'Older', ageDays: 91, flowIds: ['o1'] });
    for (const reports of permutations([few, many, older])) {
      const text = slackSummary({ reports, customers: [] });
      const bullets = text.slice(text.indexOf('*Longest outstanding*')).split('\n').slice(1);
      assert.deepEqual(
        bullets.map((line) => line.match(/#231 (.*?) https/)[1]),
        ['Older', 'Many', 'Few'],
      );
    }
  });

  test('breaks a tie on age and flows the same way whatever the table is sorted by', () => {
    // Six one-flow reports 40 days old: the two opened earlier in the day
    // first, then by report id; one with no readable date goes last.
    const tied = [
      ['Zeta', 'i-1', '2026-08-19T20:00:00.000Z', 1],
      ['Alpha', 'i-4', '2026-08-19T20:00:00.000Z', 4],
      ['Mu', 'i-2', '2026-08-19T08:00:00.000Z', 2],
      ['Beta', 'i-5', '2026-08-19T08:00:00.000Z', 3],
      ['Gamma', 'i-3', '2026-08-19T20:00:00.000Z', 1],
      ['Delta', 'i-0', null, 2],
    ].map(([name, issueId, createdAt, priorityRank]) =>
      row({
        issueId,
        createdAt,
        priorityRank,
        ageDays: 40,
        workspaceId: `ws-${name}`,
        workspaceName: name,
      }),
    );
    const longest = (reports) => {
      const text = slackSummary({ reports, customers: [] });
      return text
        .slice(text.indexOf('*Longest outstanding*'))
        .split('\n')
        .slice(1)
        .map((line) => line.match(/^• (\S+) — /)[1]);
    };
    const expected = ['Mu', 'Beta', 'Zeta', 'Gamma', 'Alpha'];
    for (const sortKey of ['age', 'flows', 'customer', 'priority']) {
      assert.deepEqual(longest(filterReports(tied, { sortKey })), expected, sortKey);
    }
    for (const order of permutations(tied)) assert.deepEqual(longest(order), expected);
  });

  test('words a count of one as one', () => {
    const one = slackSummary({
      reports: [row({ ageDays: 1, taskWolf: blocked({ blockedFlows: 1 }) })],
      customers: [customer()],
    }).split('\n');
    assert.ok(
      one[0].includes(': 1 customer, 1 open report, 1 flow parked. Oldest: 1 day.'),
      one[0],
    );
    assert.ok(one[2].startsWith('• Acme — 1 flow across 1 report (oldest 1 d)'), one[2]);
    assert.ok(one[4].includes(' · 1 d · 1 flow · blocked'), one[4]);
    assert.ok(!/\b1 (customers|open reports|reports|flows|days)\b/.test(one.join('\n')), one);

    const two = slackSummary({
      reports: [
        row({ ageDays: 2, flowIds: ['a1', 'a2'] }),
        row({
          ageDays: 2,
          flowIds: ['g1', 'g2'],
          workspaceId: 'ws-globex',
          workspaceName: 'Globex',
        }),
      ],
      customers: [],
    }).split('\n');
    assert.ok(
      two[0].includes(': 2 customers, 2 open reports, 4 flows parked. Oldest: 2 days.'),
      two[0],
    );
    assert.ok(two[2].includes(' — 2 flows across 1 report (oldest 2 d)'), two[2]);
    assert.ok(two[5].includes(' · 2 d · 2 flows'), two[5]);

    const none = slackSummary({ reports: [], customers: [] });
    assert.ok(
      none.includes(': 0 customers, 0 open reports, 0 flows parked. Oldest: 0 days.'),
      none,
    );
  });

  test('counts each culprit from its rows on screen, the largest first', () => {
    // A status filter is on: one of Acme's two reports and two of Globex's
    // are on screen. The customer entries carry the whole backlog.
    const rows = [
      row({ workspaceId: 'ws-acme', flowIds: ['a1'], ageDays: 20 }),
      row({
        workspaceId: 'ws-globex',
        workspaceName: 'Globex',
        flowIds: ['g1', 'g2'],
        ageDays: 90,
      }),
      row({
        workspaceId: 'ws-globex',
        workspaceName: 'Globex',
        flowIds: ['g2', 'g3'],
        ageDays: 40,
      }),
    ];
    const customers = [
      customer({ flowsInMaintenance: 5, openReports: 2, oldestReportAgeDays: 300 }),
      customer({
        workspaceId: 'ws-globex',
        name: 'Globex',
        flowsInMaintenance: 106,
        openReports: 31,
        oldestReportAgeDays: 410,
        taskWolf: { blockedFlows: 44, actionableFlows: 62, flowsInMaintenance: 106 },
      }),
    ];
    const culprits = (reports, listed = customers) => {
      const lines = slackSummary({ reports, customers: listed }).split('\n');
      return lines.slice(
        lines.indexOf('*Largest culprits*') + 1,
        lines.indexOf('*Longest outstanding*'),
      );
    };
    const expected = [
      '• Globex — 3 flows across 2 reports (oldest 90 d)',
      '• Acme — 1 flow across 1 report (oldest 20 d)',
    ];
    for (const order of permutations(rows)) assert.deepEqual(culprits(order), expected);
    // What the lines count is what the headline counts.
    const headline = slackSummary({ reports: rows, customers }).split('\n')[0];
    assert.ok(headline.includes(': 2 customers, 3 open reports, 4 flows parked.'), headline);
    // A customer the culprit list has filtered out still has its rows on
    // screen, so it still has its line.
    assert.deepEqual(culprits(rows, []), expected);
    assert.deepEqual(culprits(rows, undefined), expected);
  });

  test('breaks a tie between culprits the same way in any order', () => {
    const rows = ['Initech', 'Acme', 'Globex'].map((name) =>
      row({ workspaceId: `ws-${name}`, workspaceName: name, flowIds: [`${name}-1`] }),
    );
    rows.push(row({ workspaceId: 'ws-Acme', workspaceName: 'Acme', flowIds: ['Acme-1'] }));
    for (const order of permutations(rows)) {
      // The top two, and no more than the two asked for.
      const lines = slackSummary({ reports: order, customers: [], topN: 2 }).split('\n');
      assert.deepEqual(lines.slice(1, 5), [
        '*Largest culprits*',
        '• Acme — 1 flow across 2 reports (oldest 10 d)',
        '• Globex — 1 flow across 1 report (oldest 10 d)',
        '*Longest outstanding*',
      ]);
    }
  });

  test('breaks a tie between two workspaces of one name by workspace id', () => {
    const rows = [
      row({
        workspaceId: 'ws-b',
        flowIds: ['b1'],
        taskWolf: actionable({ actionableFlows: 1, assignees: ['Sam'] }),
      }),
      row({
        workspaceId: 'ws-a',
        flowIds: ['a1'],
        taskWolf: actionable({ actionableFlows: 1, assignees: ['Kalley'] }),
      }),
    ];
    for (const order of permutations(rows)) {
      const lines = slackSummary({ reports: order, customers: [] }).split('\n');
      assert.deepEqual(lines.slice(2, 4), [
        '• Acme — 1 flow across 1 report (oldest 10 d) · QAE Kalley',
        '• Acme — 1 flow across 1 report (oldest 10 d) · QAE Sam',
      ]);
    }
  });

  test('names a QAE on the customer as such, on a report and on a culprit', () => {
    const rows = [
      row({
        name: 'Own',
        ageDays: 30,
        taskWolf: actionable({
          actionableFlows: 1,
          assignees: ['Kalley'],
          customerAssignees: ['Rae'],
        }),
      }),
      row({
        name: 'Customer only',
        ageDays: 20,
        workspaceId: 'ws-globex',
        workspaceName: 'Globex',
        taskWolf: actionable({ actionableFlows: 1, customerAssignees: ['Rae\nStone', 'Sam'] }),
      }),
      row({
        name: 'Nobody',
        ageDays: 10,
        workspaceId: 'ws-initech',
        workspaceName: 'Initech',
        taskWolf: actionable({ actionableFlows: 1 }),
      }),
    ];
    const lines = slackSummary({ reports: rows, customers: [] }).split('\n');
    assert.deepEqual(lines.slice(2, 5), [
      '• Acme — 1 flow across 1 report (oldest 30 d) · QAE Kalley',
      '• Globex — 1 flow across 1 report (oldest 20 d) · customer QAE Rae Stone, Sam',
      '• Initech — 1 flow across 1 report (oldest 10 d)',
    ]);
    assert.ok(lines[6].endsWith(' · 30 d · 1 flow · QAE Kalley'), lines[6]);
    assert.ok(lines[7].endsWith(' · 20 d · 1 flow · customer QAE Rae Stone, Sam'), lines[7]);
    assert.ok(lines[8].endsWith(' · 10 d · 1 flow'), lines[8]);

    // The customer's entry names its QAEs where the rows do not.
    const older = slackSummary({
      reports: [row({ taskWolf: olderVerdict(false) })],
      customers: [customer({ taskWolf: { blockedFlows: 0, assignees: ['Rae'] } })],
    }).split('\n');
    assert.ok(older[2].endsWith('(oldest 10 d) · customer QAE Rae'), older[2]);
  });

  test('says "at least" where a customer’s blocked count is a floor', () => {
    const rows = (partial) => [
      row({ flowIds: ['b1', 'b2'], taskWolf: blocked({ blockedFlows: 2, partial }) }),
      row({ flowIds: ['u1'], taskWolf: unknown({ unlistedFlows: 1, partial }) }),
    ];
    const culprit = (reports, customers) => slackSummary({ reports, customers }).split('\n')[2];
    const counted = customer({ taskWolf: { blockedFlows: 10, actionableFlows: 4 } });
    const floors = customer({
      taskWolf: { blockedFlows: 10, actionableFlows: null, partial: true },
    });

    assert.equal(
      culprit(rows(false), [counted]),
      '• Acme — 3 flows across 2 reports (oldest 10 d) · 2 blocked',
    );
    assert.equal(
      culprit(rows(true), [floors]),
      '• Acme — 3 flows across 2 reports (oldest 10 d) · at least 2 blocked',
    );
    // The flag on the customer's entry is enough, and so is the one the rows carry.
    assert.equal(culprit(rows(false), [floors]), culprit(rows(true), [floors]));
    assert.equal(culprit(rows(true), []), culprit(rows(true), [floors]));
    // With no flow of the customer on screen unknown, the count is exact for
    // what is shown, list cut short or not.
    assert.equal(
      culprit(rows(true).slice(0, 1), [floors]),
      '• Acme — 2 flows across 1 report (oldest 10 d) · 2 blocked',
    );
    assert.equal(
      culprit(
        [
          row({
            flowIds: ['b1', 'a1'],
            taskWolf: actionable({ blockedFlows: 1, actionableFlows: 1, partial: true }),
          }),
        ],
        [floors],
      ),
      '• Acme — 2 flows across 1 report (oldest 10 d) · 1 blocked',
    );
  });

  test('says of a list cut short no more than the rows on screen allow', () => {
    const culprit = (reports) => slackSummary({ reports, customers: [] }).split('\n')[2];
    // Nothing listed as blocked, one flow not listed: it could be blocked.
    assert.equal(
      culprit([
        row({
          flowIds: ['a1', 'a2'],
          taskWolf: actionable({ actionableFlows: 1, unlistedFlows: 1, partial: true }),
        }),
      ]),
      '• Acme — 2 flows across 1 report (oldest 10 d) · blocked unknown',
    );
    // Every flow on screen was listed, and as free.
    assert.equal(
      culprit([
        row({ flowIds: ['a1', 'a2'], taskWolf: actionable({ actionableFlows: 2, partial: true }) }),
      ]),
      '• Acme — 2 flows across 1 report (oldest 10 d)',
    );
  });

  test('lists only customers that have a report on screen, with the same totals', () => {
    const rows = [
      row({
        workspaceId: 'ws-acme',
        flowIds: ['a1', 'a2'],
        taskWolf: actionable({ actionableFlows: 2 }),
      }),
      row({ workspaceId: 'ws-acme', flowIds: ['a3'], taskWolf: blocked(), ageDays: 45 }),
      row({ workspaceId: 'ws-acme', flowIds: ['a4'], taskWolf: null }),
    ];
    const customers = [
      customer({
        workspaceId: 'ws-globex',
        name: 'Globex',
        flowsInMaintenance: 106,
        taskWolf: { blockedFlows: 44, actionableFlows: 62, flowsInMaintenance: 106 },
      }),
      customer({ workspaceId: 'ws-acme', name: 'Acme', flowsInMaintenance: 4, openReports: 3 }),
    ];
    const text = slackSummary({ reports: rows, customers });
    const [headline, ...rest] = text.split('\n');
    assert.ok(
      headline.includes('1 customer, 3 open reports, 4 flows parked. Oldest: 45 days.'),
      headline,
    );
    assert.ok(
      headline.endsWith(' Task Wolf: 1 blocked on the customer, 2 actionable, 1 unknown.'),
      headline,
    );
    assert.ok(!text.includes('Globex'), text);
    assert.equal(rest[0], '*Largest culprits*');
    assert.equal(rest[1], '• Acme — 4 flows across 3 reports (oldest 45 d) · 1 blocked');
    assert.equal(rest[2], '*Longest outstanding*');
  });

  test('says the counts and oldest age are floors where QA Wolf has more reports than the scan read', () => {
    const rows = [
      row({ workspaceId: 'ws-acme', flowIds: ['a1', 'a2'], ageDays: 30 }),
      row({ workspaceId: 'ws-globex', workspaceName: 'Globex', flowIds: ['g1'], ageDays: 20 }),
    ];
    const cutShort = customer({ openReports: 5000, reportsTruncated: true });
    const whole = customer({ workspaceId: 'ws-globex', name: 'Globex' });
    const [headline, , acme, globex] = slackSummary({
      reports: rows,
      customers: [cutShort, whole],
    }).split('\n');
    assert.ok(
      headline.endsWith(
        ': 2 customers, 2 open reports, 3 flows parked. Oldest: 30 days. QA Wolf has more open reports for Acme than the scan reads. Its other reports are not listed, so these counts and its oldest age are lower bounds.',
      ),
      headline,
    );
    // Marked as the page marks its culprit row: every number, alike.
    assert.equal(acme, '• Acme — 2+ flows across 1+ reports (oldest 30+ d)');
    assert.equal(globex, '• Globex — 1 flow across 1 report (oldest 20 d)');

    const bothCut = slackSummary({
      reports: rows,
      customers: [cutShort, { ...whole, reportsTruncated: true }],
    });
    assert.ok(
      bothCut
        .split('\n')[0]
        .endsWith(
          ' QA Wolf has more open reports for Acme, Globex than the scan reads. Their other reports are not listed, so these counts and their oldest ages are lower bounds.',
        ),
      bothCut,
    );

    // Only a customer with a row on screen is named, whether or not it makes the top list.
    const onlyGlobex = slackSummary({ reports: rows.slice(1), customers: [cutShort, whole] });
    assert.ok(!onlyGlobex.includes('lower bounds'), onlyGlobex);
    const beyondTop = slackSummary({ reports: rows, customers: [cutShort, whole], topN: 0 });
    assert.ok(beyondTop.split('\n')[0].includes('for Acme than the scan reads'), beyondTop);
    // Nothing is said or marked without the flag.
    const clean = slackSummary({ reports: rows, customers: [customer(), whole] });
    assert.ok(!clean.includes('+') && !clean.includes('lower bounds'), clean);
  });

  test('says nothing about Task Wolf when no row has a verdict', () => {
    const text = slackSummary({
      reports: [row({ taskWolf: null }), row({ taskWolf: unknown() })],
      customers: [
        customer({ taskWolf: { blockedFlows: 44, actionableFlows: 62, flowsInMaintenance: 106 } }),
      ],
    });
    assert.ok(!text.split('\n')[0].includes('Task Wolf'), text);
  });
});

describe('describeScanError', () => {
  test('gives each code its heading, the server’s own message and its hint', () => {
    const rescan = 'This is usually temporary. Give it a minute and rescan.';
    const expected = {
      QAW_CONFIG: [
        'QA Wolf isn’t connected',
        'An admin needs to set the key on the server. Rescanning won’t help until then.',
      ],
      QAW_AUTH: ['QA Wolf rejected the API key', 'Rescan once the key has been updated.'],
      QAW_FORBIDDEN: [
        'QA Wolf refused the API key for this request',
        'An admin should check what the key has access to. Rescanning won’t help until then.',
      ],
      QAW_NETWORK: ['QA Wolf couldn’t be reached', rescan],
      QAW_UPSTREAM: ['QA Wolf couldn’t be reached', rescan],
      SOMETHING_ELSE: ['Couldn’t read the maintenance backlog', null],
    };
    for (const [code, [title, hint]] of Object.entries(expected)) {
      const message = `QA Wolf said no (${code}).`;
      assert.deepEqual(describeScanError({ code, message }), { title, message, hint }, code);
    }
  });

  test('a refused key (403) is an admin’s to fix', () => {
    const failure = describeScanError({ code: 'QAW_FORBIDDEN', message: 'QA Wolf said 403.' });
    assert.deepEqual(failure, {
      title: 'QA Wolf refused the API key for this request',
      message: 'QA Wolf said 403.',
      hint: 'An admin should check what the key has access to. Rescanning won’t help until then.',
    });
  });

  test('a rejected key (401) and an unknown code keep their own words', () => {
    assert.deepEqual(describeScanError({ code: 'QAW_AUTH', message: 'QA Wolf said 401.' }), {
      title: 'QA Wolf rejected the API key',
      message: 'QA Wolf said 401.',
      hint: 'Rescan once the key has been updated.',
    });
    assert.deepEqual(describeScanError({ code: 'SOMETHING_ELSE', message: 'Boom.' }), {
      title: 'Couldn’t read the maintenance backlog',
      message: 'Boom.',
      hint: null,
    });
  });

  test('a missing key is an admin’s to set, and rescanning will not help', () => {
    const failure = describeScanError({ code: 'QAW_CONFIG', message: 'No key.' });
    assert.equal(failure.title, 'QA Wolf isn’t connected');
    assert.equal(failure.message, 'No key.');
    assert.match(failure.hint, /admin/i);
    assert.match(failure.hint, /won’t help/);
  });

  test('an unreachable or failing QA Wolf is temporary: rescan', () => {
    for (const code of ['QAW_NETWORK', 'QAW_UPSTREAM']) {
      const failure = describeScanError({ code, message: 'Timed out.' });
      assert.equal(failure.title, 'QA Wolf couldn’t be reached', code);
      assert.equal(failure.message, 'Timed out.', code);
      assert.match(failure.hint, /temporary/i, code);
      assert.match(failure.hint, /rescan/i, code);
    }
  });

  test('a whole-scan failure and no snapshot get the plain heading and no hint', () => {
    for (const code of ['SCAN_FAILED', 'NO_SNAPSHOT', undefined]) {
      const failure = describeScanError({ code, message: 'Nothing cached.' });
      assert.deepEqual(failure, {
        title: 'Couldn’t read the maintenance backlog',
        message: 'Nothing cached.',
        hint: null,
      });
    }
  });

  test('a missing or empty message becomes the plain one', () => {
    for (const error of [{ code: 'QAW_AUTH' }, { code: 'QAW_CONFIG', message: '' }, null]) {
      assert.equal(
        describeScanError(error).message,
        'The maintenance backlog could not be read.',
        JSON.stringify(error),
      );
    }
    assert.equal(describeScanError(undefined).title, 'Couldn’t read the maintenance backlog');
  });
});

describe('asSentence', () => {
  test('ends a message with a full stop, unless it already ends a sentence', () => {
    assert.equal(asSentence('Claims could not be read'), 'Claims could not be read.');
    assert.equal(asSentence('  Claims could not be read.  '), 'Claims could not be read.');
    assert.equal(asSentence('Is the server up?'), 'Is the server up?');
    assert.equal(asSentence('It said "try later."'), 'It said "try later."');
    assert.equal(asSentence('(see the log.)'), '(see the log.)');
    assert.equal(asSentence(''), '');
    assert.equal(asSentence(null), '');
  });
});

describe('listNames', () => {
  test('lists names as a sentence does', () => {
    assert.equal(listNames([]), '');
    assert.equal(listNames(['Robin V.']), 'Robin V.');
    assert.equal(listNames(['Robin V.', 'Sam K.']), 'Robin V. and Sam K.');
    assert.equal(listNames(['Robin V.', 'Sam K.', 'Jo M.']), 'Robin V., Sam K. and Jo M.');
    assert.equal(listNames(undefined), '');
  });
});

// Claims, as GET /claims sends them to Robin, on invented customers.
const CLAIM_NOW = Date.parse('2026-09-30T18:00:00.000Z');
const CLAIM_HOUR = 60 * 60 * 1000;
const CLAIM_DAY = 24 * CLAIM_HOUR;
const inFuture = (ms) => new Date(CLAIM_NOW + ms).toISOString();
const CLAIM_NOTE = 'Rebuilding checkout flows';

function claim(overrides = {}) {
  return {
    workspaceId: 'ws-1',
    workspaceName: 'Harbor Lane',
    userId: 'u-robin',
    claimer: 'Robin V.',
    note: null,
    claimedAt: inFuture(-2 * CLAIM_DAY),
    expiresAt: inFuture(12 * CLAIM_DAY),
    mine: true,
    canRelease: true,
    ...overrides,
  };
}
const samOn = (workspaceId, overrides = {}) =>
  claim({
    workspaceId,
    userId: 'u-sam',
    claimer: 'Sam K.',
    mine: false,
    canRelease: false,
    ...overrides,
  });

describe('claimsByWorkspace', () => {
  test('groups the claims by customer, the viewer’s own first, then the earliest', () => {
    const jo = claim({
      userId: 'u-jo',
      claimer: 'Jo M.',
      mine: false,
      claimedAt: inFuture(-5 * CLAIM_DAY),
    });
    const sam = samOn('ws-1', { claimedAt: inFuture(-3 * CLAIM_DAY) });
    const mine = claim({ claimedAt: inFuture(-CLAIM_DAY) });
    const other = samOn('ws-2');
    const by = claimsByWorkspace([sam, mine, other, jo]);
    assert.deepEqual([...by.keys()], ['ws-1', 'ws-2']);
    assert.deepEqual(by.get('ws-1'), [mine, jo, sam]);
    assert.deepEqual(by.get('ws-2'), [other]);
    assert.equal(by.get('ws-3'), undefined);
  });

  test('is null while no claims have loaded, and empty when there are none', () => {
    assert.equal(claimsByWorkspace(null), null);
    assert.equal(claimsByWorkspace(undefined), null);
    assert.equal(claimsByWorkspace([]).size, 0);
  });
});

describe('the Claims filter', () => {
  // Robin has claimed Harbor Lane, Sam has Tidewater, nobody has Saltmarsh, and
  // the sandbox is a demo nobody has claimed.
  const rows = [
    row({ issueId: 'r-1a', workspaceId: 'ws-1', workspaceName: 'Harbor Lane' }),
    row({ issueId: 'r-1b', workspaceId: 'ws-1', workspaceName: 'Harbor Lane' }),
    row({ issueId: 'r-2', workspaceId: 'ws-2', workspaceName: 'Tidewater' }),
    row({ issueId: 'r-3', workspaceId: 'ws-3', workspaceName: 'Saltmarsh' }),
    row({ issueId: 'r-4', workspaceId: 'ws-4', workspaceName: 'Harbor sandbox', isDemo: true }),
  ];
  const customers = [
    customer({ workspaceId: 'ws-1', name: 'Harbor Lane' }),
    customer({ workspaceId: 'ws-2', name: 'Tidewater' }),
    customer({ workspaceId: 'ws-3', name: 'Saltmarsh' }),
    customer({ workspaceId: 'ws-4', name: 'Harbor sandbox', isDemo: true }),
  ];
  const claims = [claim({ note: CLAIM_NOTE }), samOn('ws-2')];
  // The filter's options as the page builds them: `choice`, judged by its ids.
  const by = (choice, extra = {}) => ({
    claim: choice,
    claimIds: claimFilterIds(claims, choice),
    ...extra,
  });
  const reportIds = (options) =>
    filterReports(rows, options)
      .map((r) => r.issueId)
      .sort();
  const customerIds = (options) => filterCustomers(customers, options).map((c) => c.workspaceId);

  test('"all" keeps every row, "unclaimed" those nobody has claimed, "mine" the viewer’s', () => {
    assert.deepEqual(reportIds(by('all')), ['r-1a', 'r-1b', 'r-2', 'r-3']);
    assert.deepEqual(reportIds(by('unclaimed')), ['r-3']);
    assert.deepEqual(reportIds(by('mine')), ['r-1a', 'r-1b']);
    assert.deepEqual(customerIds(by('all')), ['ws-1', 'ws-2', 'ws-3']);
    assert.deepEqual(customerIds(by('unclaimed')), ['ws-3']);
    assert.deepEqual(customerIds(by('mine')), ['ws-1']);
  });

  test('with no claims loaded, keeps everything, whatever it is set to', () => {
    for (const choice of ['unclaimed', 'mine']) {
      const options = { claim: choice, claimIds: claimFilterIds(null, choice) };
      assert.deepEqual(reportIds(options), ['r-1a', 'r-1b', 'r-2', 'r-3']);
      assert.deepEqual(customerIds(options), ['ws-1', 'ws-2', 'ws-3']);
    }
  });

  test('never hides the customer in focus: claimed under "unclaimed", someone else’s under "mine"', () => {
    assert.deepEqual(reportIds(by('unclaimed', { workspaceId: 'ws-1' })), ['r-1a', 'r-1b']);
    assert.deepEqual(customerIds(by('unclaimed', { focusedWorkspaceId: 'ws-1' })), [
      'ws-1',
      'ws-3',
    ]);
    assert.deepEqual(reportIds(by('mine', { workspaceId: 'ws-2' })), ['r-2']);
    assert.deepEqual(customerIds(by('mine', { focusedWorkspaceId: 'ws-2' })), ['ws-1', 'ws-2']);
  });

  test('narrows the culprits and the table to the same customers', () => {
    const workspaces = (list) => [...new Set(list.map((r) => r.workspaceId))].sort();
    for (const choice of ['all', 'unclaimed', 'mine']) {
      for (const hideDemos of [true, false]) {
        const options = by(choice, { hideDemos });
        assert.deepEqual(
          workspaces(filterReports(rows, options)),
          workspaces(filterCustomers(customers, options)),
          `${choice}, hideDemos ${hideDemos}`,
        );
      }
    }
  });

  test('under "mine" the tiles total the viewer’s claimed backlog and nothing else', () => {
    const totals = summarize(filterReports(rows, by('mine')));
    assert.equal(totals.customers, 1);
    assert.equal(totals.reports, 2);
  });

  test('hands back the snapshot’s own rows, so the CSV and the digest carry no claim', () => {
    const kept = filterReports(rows, by('mine'));
    assert.equal(kept.length, 2);
    for (const r of kept) assert.ok(rows.includes(r), r.issueId);
    const csv = reportsToCsv(kept);
    const digest = slackSummary({ reports: kept, customers });
    for (const text of [csv, digest]) {
      assert.ok(!text.includes('Robin'), text);
      assert.ok(!text.includes(CLAIM_NOTE), text);
    }
  });
});

describe('claimFilterIds', () => {
  const robins = claim({ note: CLAIM_NOTE });
  const claims = [samOn('ws-2'), robins, samOn('ws-1')];

  test('is the customers anyone has claimed for "unclaimed", the viewer’s for "mine", each once and sorted', () => {
    assert.deepEqual(claimFilterIds(claims, 'unclaimed'), ['ws-1', 'ws-2']);
    assert.deepEqual(claimFilterIds(claims, 'mine'), ['ws-1']);
    assert.deepEqual(claimFilterIds([], 'unclaimed'), []);
  });

  test('is null when the filter keeps every customer: "all", or no claims loaded', () => {
    assert.equal(claimFilterIds(claims, 'all'), null);
    assert.equal(claimFilterIds(null, 'unclaimed'), null);
    assert.equal(claimFilterIds(undefined, 'mine'), null);
  });

  test('holds still while claims change in ways the filter cannot see', () => {
    const key = (list, choice) => JSON.stringify(claimFilterIds(list, choice));
    const renewed = claim({ note: 'Rebuilding login flows', expiresAt: inFuture(14 * CLAIM_DAY) });
    const joined = [...claims, claim({ userId: 'u-jo', claimer: 'Jo M.', mine: false })];
    for (const choice of ['unclaimed', 'mine']) {
      assert.equal(key([samOn('ws-2'), renewed, samOn('ws-1')], choice), key(claims, choice));
      assert.equal(key(joined, choice), key(claims, choice), choice);
    }
    // A customer's first claim moves "unclaimed"; the viewer's own moves "mine".
    const onSaltmarsh = [...claims, samOn('ws-3')];
    assert.notEqual(key(onSaltmarsh, 'unclaimed'), key(claims, 'unclaimed'));
    assert.equal(key(onSaltmarsh, 'mine'), key(claims, 'mine'));
    const robinJoinsTidewater = [...claims, claim({ workspaceId: 'ws-2' })];
    assert.equal(key(robinJoinsTidewater, 'unclaimed'), key(claims, 'unclaimed'));
    assert.notEqual(key(robinJoinsTidewater, 'mine'), key(claims, 'mine'));
  });
});

describe('claimTimeLeft', () => {
  const left = (ms) => claimTimeLeft(inFuture(ms), CLAIM_NOW);

  test('counts whole days, rounded, from a day up', () => {
    assert.equal(left(14 * CLAIM_DAY), '14 days left');
    assert.equal(left(1.6 * CLAIM_DAY), '2 days left');
    assert.equal(left(1.2 * CLAIM_DAY), '1 day left');
    assert.equal(left(CLAIM_DAY), '1 day left');
  });

  test('counts whole hours under a day, rounded down, then "under an hour"', () => {
    assert.equal(left(23.9 * CLAIM_HOUR), '23 h left');
    assert.equal(left(5.5 * CLAIM_HOUR), '5 h left');
    assert.equal(left(CLAIM_HOUR), '1 h left');
    assert.equal(left(20 * 60 * 1000), 'under an hour left');
  });

  test('is "expired" at or past the time, and nothing for a date it cannot read', () => {
    assert.equal(left(0), 'expired');
    assert.equal(left(-CLAIM_DAY), 'expired');
    for (const value of ['not a date', null, undefined, '']) {
      assert.equal(claimTimeLeft(value, CLAIM_NOW), '', String(value));
    }
  });
});

describe('isClaimExpiring', () => {
  test('is 48 hours or less left', () => {
    const expiring = (ms) => isClaimExpiring(claim({ expiresAt: inFuture(ms) }), CLAIM_NOW);
    assert.equal(expiring(48 * CLAIM_HOUR), true);
    assert.equal(expiring(48 * CLAIM_HOUR + 1), false);
    assert.equal(expiring(CLAIM_HOUR), true);
    assert.equal(expiring(-CLAIM_HOUR), true);
    assert.equal(isClaimExpiring(claim({ expiresAt: 'soon' }), CLAIM_NOW), false);
  });
});

describe('claimTag', () => {
  const mine = claim({ note: CLAIM_NOTE });
  const sams = samOn('ws-1', { expiresAt: inFuture(14 * CLAIM_DAY) });

  test('is nothing for no claims', () => {
    assert.equal(claimTag(undefined), null);
    assert.equal(claimTag([]), null);
  });

  test('names the viewer "You" and the first other claimer otherwise, with how many more', () => {
    assert.equal(claimTag([mine]).text, 'You');
    assert.equal(claimTag([mine]).mine, true);
    assert.equal(claimTag([mine, sams]).text, 'You +1');
    const robinsSeenBySam = claim({ mine: false, canRelease: false });
    const tag = claimTag([robinsSeenBySam, sams]);
    assert.equal(tag.text, 'Robin V. +1');
    assert.equal(tag.mine, false);
  });

  test('says how long the viewer’s claim has once it is expiring, and only when given the time', () => {
    const lapsing = claim({ expiresAt: inFuture(1.2 * CLAIM_DAY) });
    const timed = claimTag([lapsing, sams], { now: CLAIM_NOW });
    assert.equal(timed.text, 'You +1 · 1 day left');
    assert.equal(timed.expiring, true);
    assert.equal(claimTag([lapsing], { now: CLAIM_NOW }).text, 'You · 1 day left');

    const untimed = claimTag([lapsing, sams]);
    assert.equal(untimed.text, 'You +1');
    assert.equal(untimed.expiring, false);
    assert.doesNotMatch(untimed.title, /left|expired/);

    // Another SE's claim running out is theirs to renew, not the viewer's to be told of.
    const theirs = claimTag([samOn('ws-1', { expiresAt: inFuture(CLAIM_HOUR) })], {
      now: CLAIM_NOW,
    });
    assert.equal(theirs.text, 'Sam K.');
    assert.equal(theirs.expiring, false);
  });

  test('lists every claimer in the title, with their note', () => {
    assert.equal(claimTag([mine, sams]).title, `You — ${CLAIM_NOTE}\nSam K.`);
    assert.equal(
      claimTag([mine, sams], { now: CLAIM_NOW }).title,
      `You — ${CLAIM_NOTE} · 12 days left\nSam K. · 14 days left`,
    );
  });
});

describe('claimReminders', () => {
  test('are the viewer’s claims about to lapse or on a customer gone from the snapshot, soonest first', () => {
    const customers = [
      customer({ workspaceId: 'ws-1', name: 'Harbor Lane' }),
      customer({ workspaceId: 'ws-2', name: 'Tidewater' }),
    ];
    const lapsing = claim({ workspaceId: 'ws-1', expiresAt: inFuture(CLAIM_DAY) });
    const fine = claim({ workspaceId: 'ws-2', expiresAt: inFuture(10 * CLAIM_DAY) });
    const cleared = claim({
      workspaceId: 'ws-9',
      workspaceName: 'Old Quay',
      expiresAt: inFuture(5 * CLAIM_DAY),
    });
    const unnamed = claim({
      workspaceId: 'ws-8',
      workspaceName: null,
      expiresAt: inFuture(3 * CLAIM_DAY),
    });
    const others = samOn('ws-1', { expiresAt: inFuture(CLAIM_HOUR) });
    const reminders = claimReminders(
      [cleared, fine, others, unnamed, lapsing],
      customers,
      CLAIM_NOW,
    );
    assert.deepEqual(
      reminders.map(({ kind, claim: c, name }) => [kind, c.workspaceId, name]),
      [
        ['expiring', 'ws-1', 'Harbor Lane'],
        ['gone', 'ws-8', 'ws-8'],
        ['gone', 'ws-9', 'Old Quay'],
      ],
    );
    assert.deepEqual(claimReminders([], customers, CLAIM_NOW), []);
  });

  test('a claim on a workspace the scan could not read is "unread", not gone, however long it has', () => {
    const customers = [customer({ workspaceId: 'ws-1', name: 'Harbor Lane' })];
    // The snapshot's `errors`: Tidewater's reports failed to load, and so did
    // a workspace nobody has claimed.
    const unread = [
      { workspaceId: 'ws-2', workspaceName: 'Tidewater', message: 'QA Wolf returned 502' },
      { workspaceId: 'ws-5', workspaceName: 'Saltmarsh', message: 'timed out' },
    ];
    const onTidewater = claim({
      workspaceId: 'ws-2',
      workspaceName: 'Tidewater',
      expiresAt: inFuture(12 * CLAIM_DAY),
    });
    const renamed = claim({
      workspaceId: 'ws-6',
      workspaceName: null,
      expiresAt: inFuture(13 * CLAIM_DAY),
    });
    const samsOnTidewater = samOn('ws-2', { expiresAt: inFuture(CLAIM_HOUR) });
    const reminders = claimReminders(
      [renamed, samsOnTidewater, onTidewater],
      customers,
      CLAIM_NOW,
      [...unread, { workspaceId: 'ws-6', workspaceName: 'Old Quay', message: 'timed out' }],
    );
    assert.deepEqual(
      reminders.map(({ kind, claim: c, name }) => [kind, c.workspaceId, name]),
      [
        ['unread', 'ws-2', 'Tidewater'],
        // Named from the scan's error when the claim carries no name.
        ['unread', 'ws-6', 'Old Quay'],
      ],
    );
    // Without the errors it would read as gone.
    assert.equal(claimReminders([onTidewater], customers, CLAIM_NOW)[0].kind, 'gone');
  });
});
