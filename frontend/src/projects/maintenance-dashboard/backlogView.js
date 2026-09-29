/**
 * View-side helpers for the Bone Pile: filtering the snapshot, describing ages
 * in words, and turning what is on screen into a CSV or a Slack line. Pure
 * functions, no React, so the page component stays a thin render.
 */

/** "3 d", "6 w", "8 mo", "1.4 y" -- coarse on purpose; the exact days sit beside it. */
export function describeAge(days) {
  const n = Number(days) || 0;
  if (n < 14) return `${n} d`;
  if (n < 60) return `${Math.round(n / 7)} w`;
  if (n < 365) return `${Math.round(n / 30.4)} mo`;
  return `${(n / 365).toFixed(1)} y`;
}

/** Age buckets used for the row tint; the thresholds are the legend. */
export function ageBucket(days) {
  const n = Number(days) || 0;
  if (n >= 180) return 'ancient';
  if (n >= 90) return 'old';
  if (n >= 30) return 'aging';
  return 'fresh';
}

export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * 'YYYY-MM-DD' in the viewer's time zone, for the export: the same calendar day
 * the page shows, where slicing the ISO string would give the UTC one.
 */
export function localIsoDate(date = new Date()) {
  if (date === null || date === '') return '';
  const local = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(local.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}

const STATUS_LABELS = {
  pending: 'Pending',
  inProgress: 'In progress',
  paused: 'Paused',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

/**
 * A failed scan, in words. The server's message already names the problem;
 * the code picks the heading and says who can fix it, because a missing or
 * rejected key is an admin's job and rescanning will not help until then.
 */
export function describeScanError(error) {
  const message = error?.message || 'The maintenance backlog could not be read.';
  switch (error?.code) {
    case 'QAW_CONFIG':
      return {
        title: 'QA Wolf isn’t connected',
        message,
        hint: 'An admin needs to set the key on the server. Rescanning won’t help until then.',
      };
    case 'QAW_AUTH':
      return {
        title: 'QA Wolf rejected the API key',
        message,
        hint: 'Rescan once the key has been updated.',
      };
    case 'QAW_FORBIDDEN':
      return {
        title: 'QA Wolf refused the API key for this request',
        message,
        hint: 'An admin should check what the key has access to. Rescanning won’t help until then.',
      };
    case 'QAW_NETWORK':
    case 'QAW_UPSTREAM':
      return {
        title: 'QA Wolf couldn’t be reached',
        message,
        hint: 'This is usually temporary. Give it a minute and rescan.',
      };
    default:
      return { title: 'Couldn’t read the maintenance backlog', message, hint: null };
  }
}

/**
 * Task Wolf's verdict on a row, in words. `blocked` is tri-state: true means
 * every flow the report parks sits behind an active blocker (waiting on the
 * customer), false means at least one is free to work, null means Task Wolf
 * said nothing that ties to this report.
 */
export function taskWolfVerdict(row) {
  const tw = row?.taskWolf;
  if (!tw || tw.blocked === null || tw.blocked === undefined) return 'unknown';
  return tw.blocked ? 'blocked' : 'actionable';
}

const isCount = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * How many of a row's flows are blocked, actionable and unknown. A blocked
 * row's are all blocked. An actionable row can be decided by one free flow,
 * so it counts what Task Wolf said of its own flows: `blockedFlows` blocked,
 * `actionableFlows` listed as free, and the ones it did not list unknown. An
 * unknown row lists no free flow, but the ones it lists as blocked are
 * blocked all the same; the rest are unknown. A count Task Wolf did not give
 * (null: no maintenance answer) counts no flow, so they stay unknown. A
 * snapshot from before `actionableFlows`, where the field is absent, takes
 * every flow that is not blocked as actionable.
 */
export function taskWolfFlowSplit(row) {
  const flows = Math.max(0, Number(row?.flowCount) || 0);
  const verdict = taskWolfVerdict(row);
  if (verdict === 'blocked') return { blocked: flows, actionable: 0, unknown: 0 };
  const tw = row?.taskWolf;
  const upTo = (count, most) => Math.min(most, Math.max(0, count));
  const blocked = isCount(tw?.blockedFlows) ? upTo(tw.blockedFlows, flows) : 0;
  if (verdict === 'unknown') return { blocked, actionable: 0, unknown: flows - blocked };
  if (tw.actionableFlows === undefined) return { blocked, actionable: flows - blocked, unknown: 0 };
  const actionable = isCount(tw.actionableFlows) ? upTo(tw.actionableFlows, flows - blocked) : 0;
  return { blocked, actionable, unknown: flows - blocked - actionable };
}

/**
 * The badge for a row: verdict, label and a tooltip that says no more than
 * Task Wolf did. "(1 of 3)" counts only the flows Task Wolf listed as free; a
 * flow it did not list is named as such, never counted as free.
 */
export function taskWolfBadge(row) {
  const verdict = taskWolfVerdict(row);
  const tw = row?.taskWolf;
  if (verdict === 'unknown') {
    let title = 'Task Wolf gave no blocked status that ties to this report';
    if (tw?.unlistedFlows > 0) {
      const missing = `${tw.unlistedFlows} of ${row.flowCount} flows on this report`;
      title = tw.partial
        ? `Task Wolf cut its list short for this customer and left out ${missing}`
        : `Task Wolf did not list ${missing}`;
      // The flows it did list are blocked, and the tiles count them so.
      const { blocked } = taskWolfFlowSplit(row);
      if (blocked > 0) title = `${blocked} of ${row.flowCount} flows blocked · ${title}`;
    }
    return { verdict, label: '—', title };
  }
  if (verdict === 'blocked') {
    return { verdict, label: '⛔ Blocked', title: tw.blockerTitle || 'Blocked in Task Wolf' };
  }
  const split = taskWolfFlowSplit(row);
  if (split.actionable === 0) {
    // Decided by the customer-wide count, not by this report's own flows. The
    // ones Task Wolf did not list are said so, as the tiles count them unknown.
    const flows = split.blocked + split.unknown;
    let title = 'Task Wolf has no blocked flows for this customer';
    if (split.unknown === 1 && flows === 1) title += '; this report’s one flow was not listed';
    else if (split.unknown === flows && flows > 0) {
      title += `; none of this report’s ${flows} flows were listed`;
    } else if (split.unknown > 0) {
      title += `; ${split.unknown} of this report’s ${flows} flows were not listed`;
    }
    return { verdict, label: '✓ Actionable', title };
  }
  const notes = [];
  if (split.blocked > 0) notes.push(`${split.blocked} of ${row.flowCount} flows blocked`);
  if (split.unknown > 0) notes.push(`${split.unknown} not listed by Task Wolf`);
  return {
    verdict,
    label: notes.length ? `✓ Actionable (${split.actionable} of ${row.flowCount})` : '✓ Actionable',
    title: notes.length ? notes.join(' · ') : 'No active blocker',
  };
}

const namesIn = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);

/**
 * Who is on a row, as two lists the page and the exports share. `own` are the
 * QAEs assigned to a flow the report parks; `customer` are those with an open
 * maintenance task for the customer, which may be about another report.
 */
export function taskWolfAssignees(row) {
  const tw = row?.taskWolf;
  return { own: namesIn(tw?.assignees), customer: namesIn(tw?.customerAssignees) };
}

/**
 * Who is on a row, in words, or null for nobody. A QAE who only has a task
 * for the customer is labelled as such, never as being on the report.
 */
export function taskWolfQae(row) {
  const { own, customer } = taskWolfAssignees(row);
  if (own.length) {
    return {
      scope: 'report',
      text: `QAE ${own.join(', ')}`,
      title: 'QAE assigned to a flow this report parks',
    };
  }
  if (customer.length) {
    return {
      scope: 'customer',
      text: `QAE on customer: ${customer.join(', ')}`,
      title: 'Has an open maintenance task for this customer, not necessarily this report',
    };
  }
  return null;
}

/**
 * "3 blocked" for a customer, or '' with nothing to say. A list Task Wolf cut
 * short (`partial`) only puts a floor under the count, and the label says so.
 */
export function taskWolfBlockedLabel(tw) {
  if (!tw) return '';
  const blocked = isCount(tw.blockedFlows) && tw.blockedFlows > 0 ? tw.blockedFlows : 0;
  if (tw.partial) return blocked ? `at least ${blocked} blocked` : 'blocked unknown';
  return blocked ? `${blocked} blocked` : '';
}

/**
 * How loudly the page says Task Wolf has no record of some customers with
 * backlog: 'hint' for a few (former customers, usually), 'warning' when it is
 * most of those asked, since that many former customers is unlikely and a
 * customer argument Task Wolf no longer takes is not. null with none, or when
 * it had no record of any and the pass's own error already says so.
 */
export function taskWolfNotFoundLevel(taskWolf) {
  if (!taskWolf?.enabled || taskWolf.pending) return null;
  const count = isCount(taskWolf.customersNotInTaskWolf) ? taskWolf.customersNotInTaskWolf : 0;
  if (count <= 0) return null;
  const queried = isCount(taskWolf.customersQueried) ? taskWolf.customersQueried : 0;
  if (taskWolf.error?.code === 'TW_ABORTED' && count >= queried) return null;
  return count > 1 && count * 2 > queried ? 'warning' : 'hint';
}

/**
 * The Task Wolf toolbar filter: 'all' | 'actionable' | 'blocked' | 'unknown'.
 * "Actionable" means Task Wolf said so; a row it said nothing about is unknown.
 */
function passesTaskWolfFilter(row, taskWolf) {
  if (taskWolf === 'blocked' || taskWolf === 'actionable' || taskWolf === 'unknown') {
    return taskWolfVerdict(row) === taskWolf;
  }
  return true;
}

/** Customer-written text on one line: newlines and runs of whitespace become one space. */
function oneLine(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Text as the search compares it: on one line and lower-cased. The needle and
 * every field it is held against go through here, so a name stored with a run
 * of spaces is found by typing it, however many spaces are typed.
 */
function searchable(text) {
  return oneLine(text).toLowerCase();
}

/** A report the way the page prints it: "#231 SSO login". */
function reportLabel(row) {
  return oneLine(`#${row.number ?? '?'} ${row.name}`);
}

/**
 * Apply the toolbar to the ranked report rows. Order is preserved from the
 * server (oldest first) unless `sortKey` says otherwise.
 */
export function filterReports(
  reports,
  {
    search = '',
    hideDemos = true,
    minFlows = 0,
    workspaceId = null,
    status = 'all',
    sortKey = 'age',
    taskWolf = 'all',
  } = {},
) {
  const needle = searchable(search);
  // A search of "#231" alone is that report number, whole: not #2310.
  const numberOnly = /^#\d+$/.test(needle);
  const filtered = (reports || []).filter((row) => {
    if (hideDemos && row.isDemo) return false;
    if (workspaceId && row.workspaceId !== workspaceId) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (minFlows > 0 && row.flowCount < minFlows) return false;
    if (!passesTaskWolfFilter(row, taskWolf)) return false;
    if (!needle) return true;
    if (numberOnly) return searchable(reportLabel(row)).split(' ')[0] === needle;
    // The report is matched as printed, so "#231 sso login" finds it as well
    // as a bare "231".
    return (
      searchable(row.workspaceName).includes(needle) ||
      searchable(reportLabel(row)).includes(needle) ||
      searchable(row.organizationName).includes(needle)
    );
  });
  const sorters = {
    age: (a, b) => b.ageDays - a.ageDays || b.flowCount - a.flowCount,
    flows: (a, b) => b.flowCount - a.flowCount || b.ageDays - a.ageDays,
    customer: (a, b) => a.workspaceName.localeCompare(b.workspaceName) || b.ageDays - a.ageDays,
    priority: (a, b) => a.priorityRank - b.priorityRank || b.ageDays - a.ageDays,
  };
  return [...filtered].sort(sorters[sortKey] || sorters.age);
}

/**
 * Task Wolf gave no full count for this customer: no answer, a count missing,
 * counts that are floors (a list cut short), or nothing counted at all.
 */
function isUncounted(tw) {
  if (!tw || tw.partial) return true;
  if (!isCount(tw.blockedFlows) || !isCount(tw.actionableFlows)) return true;
  return tw.blockedFlows === 0 && tw.actionableFlows === 0;
}

/**
 * Apply the demo toggle, search and Task Wolf filter to the ranked customer
 * rows. "Actionable" keeps customers with at least one flow Task Wolf counts
 * as free; "blocked" keeps those with any blocked flow; "unknown" keeps those
 * Task Wolf gave no full count for, so a customer it counted 0 blocked and 0
 * actionable for is unknown too. A missing count is unknown, never zero.
 */
export function filterCustomers(
  customers,
  { search = '', hideDemos = true, taskWolf = 'all' } = {},
) {
  const needle = searchable(search);
  return (customers || []).filter((row) => {
    if (hideDemos && row.isDemo) return false;
    const tw = row.taskWolf;
    const blocked = isCount(tw?.blockedFlows) ? tw.blockedFlows : null;
    const actionable = isCount(tw?.actionableFlows) ? tw.actionableFlows : null;
    if (taskWolf === 'blocked' && !(blocked > 0)) return false;
    if (taskWolf === 'actionable' && !(actionable > 0)) return false;
    if (taskWolf === 'unknown' && !isUncounted(tw)) return false;
    if (!needle) return true;
    return (
      searchable(row.name).includes(needle) || searchable(row.organizationName).includes(needle)
    );
  });
}

/** The customers, in the order given, that have at least one of `reports`. */
export function customersWithVisibleReports(customers, reports) {
  const visible = new Set((reports || []).map((row) => row.workspaceId));
  return (customers || []).filter((c) => visible.has(c.workspaceId));
}

// On a flow two reports both park, the firmer word wins.
const FLOW_VERDICT_RANK = { actionable: 0, unknown: 1, blocked: 2 };

/** A fixed order for ids and names: by code unit, the same on every machine. */
function byText(a, b) {
  const [left, right] = [String(a), String(b)];
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The word Task Wolf's own list gives each of a row's flows: blocked, free
 * (actionable) or not listed (unknown). Null for a row that does not carry the
 * lists: no maintenance answer, or a snapshot from before them.
 */
function listedFlowVerdict(row) {
  const tw = row?.taskWolf;
  if (!Array.isArray(tw?.blockedFlowIds) || !Array.isArray(tw?.freeFlowIds)) return null;
  const [blockedIds, freeIds] = [new Set(tw.blockedFlowIds), new Set(tw.freeFlowIds)];
  return (id) => {
    if (blockedIds.has(id)) return 'blocked';
    return freeIds.has(id) ? 'actionable' : 'unknown';
  };
}

/**
 * One verdict per flow the rows park, as a Map of flow id to verdict. It is
 * decided per flow by a fixed rule, never by the order of the rows: blocked
 * wins over unknown, which wins over actionable.
 *
 * A blocked row speaks for all of its flows. Any other row that carries Task
 * Wolf's list of which of its flows are blocked and which free decides each
 * flow from it, exactly; the flows it left out are unknown. An unknown row
 * without the list and no flow counted as blocked speaks for all of its flows.
 * Any other row says how many of its flows are blocked, unknown and free
 * (taskWolfFlowSplit), not which. Its blocked count goes first to the flows
 * already decided blocked and its unknown count to those decided unknown;
 * each takes last the flows decided the other word, and breaks ties by flow
 * id, which makes two rows that share flows pick the same ones.
 */
function flowVerdicts(rows) {
  const claim = (verdicts, id, verdict) => {
    const held = verdicts.get(id);
    if (held === undefined || FLOW_VERDICT_RANK[verdict] > FLOW_VERDICT_RANK[held]) {
      verdicts.set(id, verdict);
    }
  };
  const decided = new Map();
  const counted = [];
  for (const row of rows) {
    const verdict = taskWolfVerdict(row);
    const split = taskWolfFlowSplit(row);
    const listed = listedFlowVerdict(row);
    if (verdict === 'blocked' || (!listed && verdict === 'unknown' && split.blocked === 0)) {
      for (const id of row.flowIds || []) claim(decided, id, verdict);
    } else if (listed) {
      for (const id of row.flowIds || []) claim(decided, id, listed(id));
    } else counted.push({ row, split });
  }
  // Where a count looks first: flows already decided the same word, then
  // flows nothing decided, then flows decided the other word.
  const preferring = (verdict) => (id) => {
    const held = decided.get(id);
    if (held === undefined) return 1;
    return held === verdict ? 0 : 2;
  };
  const verdicts = new Map(decided);
  for (const { row, split } of counted) {
    let left = [...new Set(row.flowIds || [])];
    for (const [verdict, count] of [
      ['blocked', split.blocked],
      ['unknown', split.unknown],
    ]) {
      const rank = preferring(verdict);
      left.sort((a, b) => rank(a) - rank(b) || byText(a, b));
      for (const id of left.slice(0, count)) claim(verdicts, id, verdict);
      left = left.slice(count);
    }
    for (const id of left) claim(verdicts, id, 'actionable');
  }
  return verdicts;
}

/**
 * Totals over the visible report rows and nothing else, so the tiles never
 * contradict the table. A flow two reports both park is one flow with one
 * verdict (flowVerdicts), so blocked + actionable + unknown is always `flows`,
 * in whatever order the rows come. `withQae` counts the rows with a QAE of
 * their own, `withCustomerQae` those with none whose customer has one.
 * `withTaskWolf` counts the rows Task Wolf said something of: a verdict, or a
 * flow of an unknown row listed as blocked.
 */
export function summarize(reports) {
  const rows = reports || [];
  const workspaceIds = new Set();
  const reportsBy = { blocked: 0, actionable: 0, unknown: 0 };
  let oldest = 0;
  let withQae = 0;
  let withCustomerQae = 0;
  let withTaskWolf = 0;
  for (const row of rows) {
    workspaceIds.add(row.workspaceId);
    const verdict = taskWolfVerdict(row);
    reportsBy[verdict] += 1;
    if (verdict !== 'unknown' || taskWolfFlowSplit(row).blocked > 0) withTaskWolf += 1;
    if (row.ageDays > oldest) oldest = row.ageDays;
    const { own, customer } = taskWolfAssignees(row);
    if (own.length) withQae += 1;
    else if (customer.length) withCustomerQae += 1;
  }

  const verdicts = flowVerdicts(rows);
  const flowsBy = { blocked: 0, actionable: 0, unknown: 0 };
  for (const verdict of verdicts.values()) flowsBy[verdict] += 1;

  return {
    customers: workspaceIds.size,
    reports: rows.length,
    flows: verdicts.size,
    oldestDays: oldest,
    blockedReports: reportsBy.blocked,
    actionableReports: reportsBy.actionable,
    unknownReports: reportsBy.unknown,
    withQae,
    withCustomerQae,
    blockedFlows: flowsBy.blocked,
    actionableFlows: flowsBy.actionable,
    unknownFlows: flowsBy.unknown,
    withTaskWolf,
  };
}

const countOf = (count, noun) => `${count} ${count === 1 ? noun : `${noun}s`}`;

/** The flow counts under the "Flows parked" tile, from summarize(). */
export function taskWolfFlowsLabel(totals) {
  const parts = [
    `${totals.blockedFlows.toLocaleString()} blocked on the customer`,
    `${totals.actionableFlows.toLocaleString()} actionable`,
  ];
  if (totals.unknownFlows > 0) parts.push(`${totals.unknownFlows.toLocaleString()} unknown`);
  return parts.join(' · ');
}

/** The report counts under the "Open maintenance reports" tile, from summarize(). */
export function taskWolfReportsLabel(totals) {
  const parts = [
    `${totals.blockedReports.toLocaleString()} fully blocked`,
    `${totals.actionableReports.toLocaleString()} actionable`,
  ];
  if (totals.unknownReports > 0) parts.push(`${totals.unknownReports.toLocaleString()} unknown`);
  parts.push(`${totals.withQae.toLocaleString()} with a QAE on it`);
  if (totals.withCustomerQae > 0) {
    parts.push(`${totals.withCustomerQae.toLocaleString()} more with a QAE on the customer`);
  }
  return parts.join(' · ');
}

/**
 * One CSV cell. Names and titles are written by customers, and a sheet runs a
 * cell that starts with = + - @ (or a tab or carriage return) as a formula, so
 * those get a leading apostrophe, which makes the sheet read them as text.
 * Numbers the export writes itself, and text that is only a signed number,
 * pass through untouched.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  const formula = /^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text);
  if (formula) text = `'${text}`;
  return formula || /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV of the visible report rows, oldest first, ready for a sheet. It opens
 * with a byte-order mark so Excel reads it as UTF-8 and keeps accented names.
 */
export function reportsToCsv(reports) {
  const header = [
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
  const lines = [header.map(csvCell).join(',')];
  for (const row of reports) {
    const qae = taskWolfAssignees(row);
    lines.push(
      [
        row.workspaceName,
        row.organizationName,
        row.number ?? '',
        row.name,
        row.ageDays,
        row.flowCount,
        statusLabel(row.status),
        row.priority,
        row.createdAt ? localIsoDate(row.createdAt) : '',
        taskWolfVerdict(row),
        row.taskWolf?.blockerTitle || '',
        qae.own.join('; '),
        qae.customer.join('; '),
        row.url || '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

/**
 * The customers behind the visible rows, the one with the most flows first.
 * Each is counted from its own visible rows and nothing else, so a line never
 * quotes more than the headline above it; the customer's entry, when the page
 * has one, lends the name and what Task Wolf said of the customer as a whole.
 */
function visibleCulprits(reports, customers) {
  const rowsBy = new Map();
  for (const row of reports || []) {
    if (!rowsBy.has(row.workspaceId)) rowsBy.set(row.workspaceId, []);
    rowsBy.get(row.workspaceId).push(row);
  }
  const entries = new Map((customers || []).map((c) => [c.workspaceId, c]));
  const culprits = [...rowsBy].map(([workspaceId, rows]) => {
    const tw = entries.get(workspaceId)?.taskWolf;
    const qae = rows.map(taskWolfAssignees);
    return {
      workspaceId,
      name: oneLine(entries.get(workspaceId)?.name ?? rows[0].workspaceName),
      totals: summarize(rows),
      partial: Boolean(tw?.partial) || rows.some((row) => row.taskWolf?.partial),
      qae: {
        own: [...new Set(qae.flatMap((who) => who.own))],
        customer: [...new Set([...namesIn(tw?.assignees), ...qae.flatMap((who) => who.customer)])],
      },
    };
  });
  return culprits.sort(
    (a, b) =>
      b.totals.flows - a.totals.flows ||
      b.totals.reports - a.totals.reports ||
      b.totals.oldestDays - a.totals.oldestDays ||
      byText(a.name, b.name) ||
      byText(a.workspaceId, b.workspaceId),
  );
}

/** When a report was opened, in ms; a missing or unreadable date sorts after every real one. */
function openedAt(row) {
  const time = row.createdAt == null ? NaN : new Date(row.createdAt).getTime();
  return Number.isNaN(time) ? Infinity : time;
}

/**
 * A short Slack-ready digest of the visible backlog: headline totals, the top
 * culprits and the oldest reports, all counted from the rows on screen,
 * whatever order the table is in. It is pasted into the composer by hand, so
 * it is plain text with Slack's *bold* and bare URLs, which Slack links by
 * itself.
 */
export function slackSummary({ reports, customers, generatedAt, topN = 5 }) {
  const totals = summarize(reports);
  const when = generatedAt ? formatDateTime(generatedAt) : 'now';
  const unknownNote = totals.unknownFlows ? `, ${totals.unknownFlows} unknown` : '';
  const taskWolfNote = totals.withTaskWolf
    ? ` Task Wolf: ${totals.blockedFlows} blocked on the customer, ${totals.actionableFlows} actionable${unknownNote}.`
    : '';
  const lines = [
    `*Maintenance backlog* (snapshot ${when}): ${countOf(totals.customers, 'customer')}, ${countOf(totals.reports, 'open report')}, ${countOf(totals.flows, 'flow')} parked. Oldest: ${countOf(totals.oldestDays, 'day')}.${taskWolfNote}`,
  ];
  // A QAE who only has a task for the customer is never passed off as being
  // on the report.
  const qaeNote = ({ own, customer }) => {
    if (own.length) return ` · QAE ${own.map(oneLine).join(', ')}`;
    return customer.length ? ` · customer QAE ${customer.map(oneLine).join(', ')}` : '';
  };
  const culprits = visibleCulprits(reports, customers).slice(0, topN);
  if (culprits.length) {
    lines.push('*Largest culprits*');
    for (const c of culprits) {
      // Where Task Wolf cut the customer's list short, the count is a floor
      // only while a flow on screen is unknown: it may be blocked too. With
      // every flow on screen decided, the count is exact for what is shown.
      const floor = c.partial && c.totals.unknownFlows > 0;
      const blocked = taskWolfBlockedLabel({ blockedFlows: c.totals.blockedFlows, partial: floor });
      lines.push(
        `• ${c.name} — ${countOf(c.totals.flows, 'flow')} across ${countOf(c.totals.reports, 'report')} (oldest ${c.totals.oldestDays} d)${blocked ? ` · ${blocked}` : ''}${qaeNote(c.qae)}`,
      );
    }
  }
  // Ages are whole days, so ties are common; opened earlier, then the report
  // id, settle them, so the table's sort never picks who makes the list.
  const oldest = [...(reports || [])]
    .sort(
      (a, b) =>
        b.ageDays - a.ageDays ||
        b.flowCount - a.flowCount ||
        openedAt(a) - openedAt(b) ||
        byText(a.issueId, b.issueId),
    )
    .slice(0, topN);
  if (oldest.length) {
    lines.push('*Longest outstanding*');
    for (const r of oldest) {
      const link = r.url ? `${reportLabel(r)} ${r.url}` : reportLabel(r);
      const blocker = oneLine(r.taskWolf?.blockerTitle);
      const marker =
        taskWolfVerdict(r) === 'blocked' ? ` · blocked${blocker ? ` (${blocker})` : ''}` : '';
      lines.push(
        `• ${oneLine(r.workspaceName)} — ${link} · ${r.ageDays} d · ${countOf(r.flowCount, 'flow')}${marker}${qaeNote(taskWolfAssignees(r))}`,
      );
    }
  }
  return lines.join('\n');
}

/** Save text as a download without a library. */
export function downloadText(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
