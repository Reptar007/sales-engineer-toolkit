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

const STATUS_LABELS = {
  pending: 'Pending',
  inProgress: 'In progress',
  paused: 'Paused',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
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

/** The Task Wolf toolbar filter: 'all' | 'actionable' | 'blocked'. */
function passesTaskWolfFilter(row, taskWolf) {
  if (taskWolf === 'blocked') return taskWolfVerdict(row) === 'blocked';
  if (taskWolf === 'actionable') return taskWolfVerdict(row) !== 'blocked';
  return true;
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
  const needle = search.trim().toLowerCase();
  const filtered = (reports || []).filter((row) => {
    if (hideDemos && row.isDemo) return false;
    if (workspaceId && row.workspaceId !== workspaceId) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (minFlows > 0 && row.flowCount < minFlows) return false;
    if (!passesTaskWolfFilter(row, taskWolf)) return false;
    if (!needle) return true;
    return (
      row.workspaceName.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle) ||
      String(row.number ?? '').includes(needle) ||
      (row.organizationName || '').toLowerCase().includes(needle)
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
 * Apply the demo toggle, search and Task Wolf filter to the ranked customer
 * rows. "Actionable" keeps customers with at least one free flow (or no Task
 * Wolf answer); "blocked" keeps those with any blocked flow.
 */
export function filterCustomers(
  customers,
  { search = '', hideDemos = true, taskWolf = 'all' } = {},
) {
  const needle = search.trim().toLowerCase();
  return (customers || []).filter((row) => {
    if (hideDemos && row.isDemo) return false;
    const tw = row.taskWolf;
    if (taskWolf === 'blocked' && !(tw && tw.blockedFlows > 0)) return false;
    if (taskWolf === 'actionable' && tw && tw.actionableFlows === 0 && tw.flowsInMaintenance > 0) {
      return false;
    }
    if (!needle) return true;
    return (
      row.name.toLowerCase().includes(needle) ||
      (row.organizationName || '').toLowerCase().includes(needle)
    );
  });
}

/** Totals over whatever rows are on screen, so the tiles never contradict the table. */
export function summarize(reports, customers) {
  const flowIds = new Set();
  let oldest = 0;
  let blockedReports = 0;
  let withQae = 0;
  for (const row of reports) {
    for (const id of row.flowIds || []) flowIds.add(id);
    if (row.ageDays > oldest) oldest = row.ageDays;
    if (taskWolfVerdict(row) === 'blocked') blockedReports += 1;
    if (row.taskWolf?.assignees?.length) withQae += 1;
  }
  let blockedFlows = 0;
  let actionableFlows = 0;
  let withTaskWolf = 0;
  for (const c of customers) {
    if (!c.taskWolf) continue;
    withTaskWolf += 1;
    blockedFlows += c.taskWolf.blockedFlows || 0;
    actionableFlows += c.taskWolf.actionableFlows || 0;
  }
  return {
    customers: customers.length,
    reports: reports.length,
    flows: flowIds.size,
    oldestDays: oldest,
    blockedReports,
    withQae,
    blockedFlows,
    actionableFlows,
    withTaskWolf,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV of the visible report rows, oldest first, ready for a sheet. */
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
    'URL',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of reports) {
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
        row.createdAt ? row.createdAt.slice(0, 10) : '',
        taskWolfVerdict(row),
        row.taskWolf?.blockerTitle || '',
        (row.taskWolf?.assignees || []).join('; '),
        row.url || '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A short Slack-ready digest of the visible backlog: headline totals, the top
 * culprits and the oldest reports. Plain text with Slack's *bold*.
 */
export function slackSummary({ reports, customers, generatedAt, topN = 5 }) {
  const totals = summarize(reports, customers);
  const when = generatedAt ? formatDateTime(generatedAt) : 'now';
  const taskWolfNote = totals.withTaskWolf
    ? ` Task Wolf: ${totals.blockedFlows} blocked on the customer, ${totals.actionableFlows} actionable.`
    : '';
  const lines = [
    `*Maintenance backlog* (snapshot ${when}): ${totals.customers} customers, ${totals.reports} open reports, ${totals.flows} flows parked. Oldest: ${totals.oldestDays} days.${taskWolfNote}`,
  ];
  const culprits = customers.slice(0, topN);
  if (culprits.length) {
    lines.push('*Largest culprits*');
    for (const c of culprits) {
      const tw = c.taskWolf;
      const blocked = tw && tw.blockedFlows ? ` · ${tw.blockedFlows} blocked` : '';
      const qae = tw && tw.assignees?.length ? ` · QAE ${tw.assignees.join(', ')}` : '';
      lines.push(
        `• ${c.name} — ${c.flowsInMaintenance} flows across ${c.openReports} ${c.openReports === 1 ? 'report' : 'reports'} (oldest ${c.oldestReportAgeDays} d)${blocked}${qae}`,
      );
    }
  }
  const oldest = reports.slice(0, topN);
  if (oldest.length) {
    lines.push('*Longest outstanding*');
    for (const r of oldest) {
      const link = r.url
        ? `<${r.url}|#${r.number ?? '?'} ${r.name}>`
        : `#${r.number ?? '?'} ${r.name}`;
      const verdict = taskWolfVerdict(r);
      const marker =
        verdict === 'blocked'
          ? ` · blocked${r.taskWolf.blockerTitle ? ` (${r.taskWolf.blockerTitle})` : ''}`
          : '';
      const qae = r.taskWolf?.assignees?.length ? ` · QAE ${r.taskWolf.assignees.join(', ')}` : '';
      lines.push(
        `• ${r.workspaceName} — ${link} · ${r.ageDays} d · ${r.flowCount} flows${marker}${qae}`,
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
