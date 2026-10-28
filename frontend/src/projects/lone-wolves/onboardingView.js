/**
 * Lone Wolves -- pure helpers for the page: labels, filters, the milestone
 * timeline and month calendar, and the CSV and Slack exports.
 *
 * Imports nothing, so the backend's test runner can load it directly (the
 * frontend has none), as backlogView.js is for the Bone Pile.
 */

export const SEGMENT_LABELS = {
  self: 'Self-serve',
  custom: 'Custom contract',
  pilot: 'Pilot',
  hybrid: 'Hybrid',
};

export const STEP_LABELS = [
  'First flow active',
  'First run started by the customer',
  'Daily run producing results',
  'First real bug reported',
  'Named owner reviewing failures',
  'Client building tests',
];

export const STEP_WORDS = { y: 'Done', n: 'Not yet', u: 'Unknown' };

export const STATE_WORDS = {
  kickoff: 'kickoff',
  done: 'done',
  missed: 'missed',
  unknown: 'unknown',
  later: 'coming up',
};

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'self', label: 'Self-serve' },
  { id: 'custom', label: 'Custom contract' },
  { id: 'pilot', label: 'Pilot' },
  { id: 'hybrid', label: 'Hybrid' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAY_MS = 24 * 60 * 60 * 1000;

/** "13 Oct" for an ISO date, read in UTC so a kickoff day never shifts. */
export function formatDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function monthName(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

/** Rows a filter chip keeps. */
export function filterRows(rows, filter) {
  if (filter === 'all') return rows;
  if (filter === 'attention') return rows.filter((row) => row.status !== 'On track');
  return rows.filter((row) => row.segment === filter);
}

export function filterCounts(rows) {
  return Object.fromEntries(FILTERS.map((f) => [f.id, filterRows(rows, f.id).length]));
}

export function dayLabel(row) {
  if (row.day == null) return '—';
  return `Day ${row.day}${row.pilotDays ? ` of ${row.pilotDays}` : ''}`;
}

export function segmentLabel(segment) {
  return SEGMENT_LABELS[segment] || SEGMENT_LABELS.self;
}

export function environmentLabel(status) {
  return (
    {
      blocked: 'Blocked',
      needsInvestigation: 'Needs investigation',
      ready: 'Ready',
    }[status] || 'Unknown'
  );
}

/** The runs cell: the last 24 hours, or when the last run was. */
export function describeRuns(runs) {
  if (!runs) return '—';
  if (runs.total === 0) {
    return runs.lastRunAt ? `none in 24h · last ${formatDay(runs.lastRunAt)}` : 'none';
  }
  const parts = [`${runs.pass} pass`];
  if (runs.fail) parts.push(`${runs.fail} fail`);
  if (runs.running) parts.push(`${runs.running} running`);
  return parts.join(' · ');
}

/** The trigger column's badge: none, some selecting nothing, or all fine. */
export function triggerCheck(triggers) {
  if (!triggers) return { text: '—', tone: 'unknown' };
  if (triggers.count === 0) return { text: 'None set up', tone: 'bad' };
  if (triggers.empty > 0) {
    return {
      text: `${triggers.empty} ${triggers.empty === 1 ? 'matches' : 'match'} no flow`,
      tone: 'bad',
    };
  }
  return { text: triggers.count === 1 ? 'Matches flows' : 'All match flows', tone: 'good' };
}

export function linearUrl(issue) {
  return issue ? `https://linear.app/qawolf/issue/${encodeURIComponent(issue)}` : null;
}

/** The six steps of a row with label and word, for the dots and the card. */
export function activationList(activation) {
  return STEP_LABELS.map((label, index) => {
    const flag = activation?.charAt(index) || 'u';
    return { label, flag, word: STEP_WORDS[flag] };
  });
}

export function doneCount(activation) {
  return (activation || '').split('').filter((flag) => flag === 'y').length;
}

const chip = (label, at, state) => ({
  label,
  at,
  state,
  sub: `${formatDay(at)} · ${STATE_WORDS[state]}`,
  title: `${label}: ${STATE_WORDS[state]} (target ${formatDay(at)})`,
});

/**
 * The "By workspace" view: one row per workspace with a kickoff date, its
 * steps grouped under the day they are due, and the rest listed apart.
 */
export function timeline(rows) {
  const scheduled = [];
  const unscheduled = [];
  for (const row of rows) {
    if (!row.milestones) {
      unscheduled.push(row);
      continue;
    }
    const steps = row.milestones.steps.map((s) => chip(s.label, s.at, s.state));
    const decision = row.milestones.decision;
    scheduled.push({
      row,
      kickoff: formatDay(row.milestones.kickoffAt),
      columns: [
        [steps[0]],
        [steps[1], steps[2]],
        [steps[3]],
        [steps[4], steps[5]],
        decision
          ? [chip(decision.label, decision.at, decision.state)]
          : [
              {
                label: 'No end date',
                sub: 'self-managed, ongoing',
                state: 'unknown',
                title: 'No pilot end date',
              },
            ],
      ],
    });
  }
  return { scheduled, unscheduled };
}

const STATE_ORDER = { missed: 0, unknown: 1, kickoff: 2, later: 3, done: 4 };

/** Every dated event across the rows, for the month calendar. */
export function calendarEvents(rows) {
  const events = [];
  for (const row of rows) {
    const m = row.milestones;
    if (!m) continue;
    const name = row.name;
    events.push({ row, at: m.kickoffAt, state: 'kickoff', text: `${name} · Kickoff` });
    for (const step of m.steps) {
      events.push({ row, at: step.at, state: step.state, text: `${name} · ${step.label}` });
    }
    if (m.decision) {
      events.push({
        row,
        at: m.decision.at,
        state: m.decision.state,
        text: `${name} · ${m.decision.label}`,
      });
    }
  }
  return events;
}

const utcDay = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * A Sunday-first month grid: whole weeks, days outside the month muted, at
 * most `perDay` events a day with the rest counted as "+N more", missed ones
 * first.
 */
export function calendarCells(rows, year, month, now = Date.now(), perDay = 3) {
  const events = calendarEvents(rows);
  const first = Date.UTC(year, month, 1);
  const lead = new Date(first).getUTCDay();
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + daysIn) / 7) * 7;
  const today = utcDay(now);
  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const at = first + (i - lead) * DAY_MS;
    const date = new Date(at);
    const inMonth = date.getUTCMonth() === month;
    const day = inMonth
      ? events
          .filter((e) => utcDay(Date.parse(e.at)) === at)
          .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
      : [];
    cells.push({
      key: at,
      day: date.getUTCDate(),
      inMonth,
      isToday: at === today,
      isWeekend: i % 7 === 0 || i % 7 === 6,
      events: day.slice(0, perDay),
      more: Math.max(0, day.length - perDay),
    });
  }
  return cells;
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The table as CSV, one line per workspace. */
export function rowsToCsv(rows) {
  const header = [
    'Workspace',
    'Type',
    'Kickoff',
    'Day',
    'Steps done',
    'Flows active',
    'Flows draft',
    'Runs 24h pass',
    'Runs 24h fail',
    'Environment',
    'Triggers',
    'Triggers matching no flow',
    'Open bugs',
    'Unprioritized bugs',
    'Bugs last 24h',
    'Status',
    'Reason',
    'Linear',
    'AE',
    'CSM',
    'Next step',
  ];
  const lines = rows.map((row) =>
    [
      row.name,
      segmentLabel(row.segment),
      row.kickoffOn ? row.kickoffOn.slice(0, 10) : '',
      row.day ?? '',
      `${doneCount(row.activation)} of 6`,
      row.flows?.active ?? '',
      row.flows?.draft ?? '',
      row.runs?.pass ?? '',
      row.runs?.fail ?? '',
      environmentLabel(row.environment?.status),
      row.triggers?.count ?? '',
      row.triggers?.empty ?? '',
      row.bugs?.open ?? '',
      row.bugs?.unprioritized ?? '',
      row.bugs?.newToday ?? '',
      row.status,
      row.reason || '',
      row.linearIssue || '',
      row.ae || '',
      row.csm || '',
      row.nextStep || '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/** A Slack-ready pulse: the tiles, then every workspace that needs a look. */
export function slackPulse(rows, summary, builtAt) {
  const lines = [
    `*Self-serve onboarding pulse* (${builtAt ? new Date(builtAt).toUTCString() : 'now'})`,
    `${summary.total} workspaces · ${summary.stalled} stalled · ${summary.dailyBad} with failing runs · ${summary.blocked} with a blocked environment`,
  ];
  const attention = rows.filter((row) => row.status === 'Stalled' || row.status === 'Watch');
  if (attention.length) lines.push('');
  for (const row of attention) {
    const day = row.day == null ? '' : ` (${dayLabel(row)})`;
    lines.push(`• *${row.name}*${day}: ${row.status}. ${row.reason || ''}`.trim());
  }
  return lines.join('\n');
}

/**
 * The pricing a CSM can put in a customer's message. Both prices are real:
 * customers signed before 10/19 are on old pricing until their CSM moves
 * them, so the page shows both and the CSM picks per message.
 */
export const PRICINGS = [
  { id: 'old', label: 'Old pricing', short: 'Old' },
  { id: 'new', label: 'New pricing', short: 'New' },
  { id: 'none', label: 'Counts only', short: 'None' },
];

/** "$8.71". */
export function formatMoney(amount) {
  return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Mon 19 Oct – Sun 25 Oct" for a week starting Monday 00:00 UTC. */
export function weekRange(weekStart) {
  const start = Date.parse(weekStart);
  return `Mon ${formatDay(start)} – Sun ${formatDay(start + 6 * DAY_MS)}`;
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "22 runs · 44 test runs · 58.1 runner min · 44 credits". */
export function describeUsage(week) {
  if (!week) return '—';
  return [
    plural(week.runs, 'run'),
    plural(week.flowRuns, 'test run'),
    `${week.runnerMinutes.toLocaleString('en-US')} runner min`,
    plural(week.credits, 'credit'),
  ].join(' · ');
}

/**
 * One pricing's dollar line for a week: "new" is credits at $1, "old" is
 * runner minutes at $0.15 and says AI credits are not included. Null for
 * "none" or a week the server did not price.
 */
export function describePrice(week, pricing) {
  const price = week?.prices?.[pricing];
  if (!price) return null;
  if (pricing === 'new') {
    return `${formatMoney(price.amount)} (${plural(week.credits, 'run credit')} at ${formatMoney(price.rate)})`;
  }
  return `${formatMoney(price.amount)} (${week.runnerMinutes} runner min at ${formatMoney(price.rate)}/min; AI credits not included)`;
}

/**
 * Last week's usage as a short message the CSM posts to the customer, like
 * the Bone Pile's Slack summary, on the pricing the CSM picked: old shows
 * minutes and their price, new shows credits and theirs, counts only shows
 * both counts and no dollars. Null when last week could not be counted.
 */
export function usageMessage(row, pricing = 'none') {
  const week = row?.usage?.lastWeek;
  if (!week) return null;
  const where = row.environmentName ? ` in your ${row.environmentName} environment` : '';
  const lines = [
    `Hi ${row.name} team! Your QA Wolf usage for ${weekRange(week.weekStart)}${where}:`,
    `• ${plural(week.runs, 'run')}, ${plural(week.flowRuns, 'test run')}`,
  ];
  if (pricing !== 'new') {
    lines.push(`• ${week.runnerMinutes.toLocaleString('en-US')} runner minutes, retries included`);
  }
  if (pricing !== 'old') lines.push(`• ${plural(week.credits, 'run credit')}`);
  const price = describePrice(week, pricing);
  if (price) lines.push(`• ${price}`);
  lines.push('Any questions, just reply here.');
  return lines.join('\n');
}

const normalizePerson = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The rows a CSM follows on their dashboard: those whose CSM field names
 * them (by full name, as the CSM picker saves it, or by email), or every
 * row when `all` (the CSM lead and admins).
 */
export function clientsFor(rows, { all = false, name = '', email = '' } = {}) {
  if (all) return rows;
  const wanted = new Set([normalizePerson(name), normalizePerson(email)].filter(Boolean));
  return rows.filter((row) => wanted.has(normalizePerson(row.csm)));
}

export function downloadText(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
