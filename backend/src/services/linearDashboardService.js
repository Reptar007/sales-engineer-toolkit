/**
 * Per-user Linear "workload" for the dashboard.
 * Returns the logged-in user's open issues in LINEAR_TEAM_ID, grouped by project.
 * Env: LINEAR_API_KEY, LINEAR_TEAM_ID, optional LINEAR_APP_URL
 */

import { getPrisma } from '../lib/prisma.js';
import { resolveLinearUserByEmail, linearGraphQL } from '../lib/linearClient.js';

// Placeholder values that templated Linear tickets often carry when a
// field hasn't actually been filled in (e.g. "Unknown Contract Owner",
// "TBD", "N/A"). Treated as null so the dashboard renders a clean "—"
// instead of leaking the boilerplate into the table.
const PLACEHOLDER_VALUE_RE = /^(?:unknown(?:\s+\S+){0,4}|tbd|tba|n\/?a|none|null|pending|—|-+)$/i;

// Pull a labeled field out of a Linear issue description that follows the
// SE template ("Contract Owner: Jordan", "Due Date: 2026-04-28", etc.).
// Tolerant of bold markdown wrappers (**Field:** value) and surrounding
// whitespace. Returns null when the field isn't present or the value is
// a known placeholder.
function extractDescriptionField(description, label) {
  if (!description || typeof description !== 'string') return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)\\s*\\**\\s*${escaped}\\s*\\**\\s*:\\s*([^\\n]+)`, 'i');
  const match = description.match(re);
  if (!match) return null;
  const value = match[1].replace(/\*\*/g, '').trim();
  if (!value) return null;
  if (PLACEHOLDER_VALUE_RE.test(value)) return null;
  return value;
}

// Try several common label variants for the AE / Contract Owner field.
// SE ticket templates have drifted over time — newer tickets use
// "Requested By" or "AE", older ones still say "Contract Owner" — so
// a single-label lookup silently drops a meaningful slice of tickets
// from per-AE rollups (and renders "—" in the AE column of the Active
// Hunts widget). We try the labels in priority order and return the
// first non-empty match.
const AE_FIELD_LABELS = [
  'Requested By',
  'Contract Owner',
  'Account Executive',
  'Account Owner',
  'AE Owner',
  'AE',
];

// Tickets created via the Slack-to-Linear bot embed the requester's
// Slack user handle inline with the name, e.g.
//   "Requested By: Rob Linsmayer (<@U06R20FJU30>)"
// We strip the parenthesized handle (and any other trailing
// parenthetical) so the extracted value is just the human-readable
// name we can match against the team's AE roster. Falls through
// untouched when there's no parenthetical to remove.
function stripInlineMentions(value) {
  if (typeof value !== 'string') return value;
  return (
    value
      // Slack-style "(<@USERID>)" or "<@USERID>"
      .replace(/\s*\(?<@[A-Z0-9]+>\)?\s*/g, ' ')
      // Linear/Markdown "@username" or "@First Last" — keep the body,
      // drop the marker, since AEs sometimes get @-tagged inline.
      .replace(/@([A-Za-z][\w.-]*)/g, '$1')
      // Bracketed user IDs left over from other bot integrations
      .replace(/\s*\[[^\]]*\]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function extractAeName(description) {
  for (const label of AE_FIELD_LABELS) {
    const raw = extractDescriptionField(description, label);
    if (!raw) continue;
    const cleaned = stripInlineMentions(raw);
    if (cleaned) return cleaned;
  }
  return null;
}

// Map a state name/type pair to one of the three frontend tones the
// status pill knows how to render.
function deriveStatus(state) {
  if (!state) return { status: 'Backlog', tone: 'backlog' };
  const type = (state.type || '').toLowerCase();
  const name = (state.name || '').toLowerCase();
  if (name.includes('review')) return { status: state.name || 'In review', tone: 'review' };
  if (type === 'started') return { status: state.name || 'In progress', tone: 'progress' };
  if (type === 'unstarted' || type === 'backlog') {
    return { status: state.name || 'Backlog', tone: 'backlog' };
  }
  return { status: state.name || 'Backlog', tone: 'backlog' };
}

// Special-case labels that elevate an issue to its own visual treatment
// in the dashboard. When present, the row is highlighted (pink for
// "AI Demo", purple for "AI Workshop") and its Status pill is replaced
// with the matching label so the SE can spot prep-heavy work at a
// glance regardless of where it sits in the workflow. The two are
// rendered with different colors but otherwise share behavior — both
// flip `isAiDemo` so aggregate counts (page header chrome, dashboard
// summary) treat them as one "AI prep" bucket.
const AI_DEMO_LABEL_RE = /^ai\s*demo$/i;
const AI_WORKSHOP_LABEL_RE = /^ai\s*workshop$/i;

// Returns 'demo' | 'workshop' | null. The first match wins, and the
// label-name comparison is exact (anchored) so a label like "AI Demo
// Prep" doesn't accidentally trigger the highlight.
function classifyAiLabel(issue) {
  const nodes = issue?.labels?.nodes;
  if (!Array.isArray(nodes)) return null;
  for (const label of nodes) {
    const name = (label?.name || '').trim();
    if (AI_DEMO_LABEL_RE.test(name)) return 'demo';
    if (AI_WORKSHOP_LABEL_RE.test(name)) return 'workshop';
  }
  return null;
}

function mapIssue(issue) {
  const state = issue.state;
  if (state) {
    const type = (state.type || '').toLowerCase();
    if (type === 'completed' || type === 'canceled') {
      return null;
    }
  }

  let { status, tone } = deriveStatus(state);
  // `aiCategory` discriminates "AI Demo" (pink) from "AI Workshop"
  // (purple). `isAiDemo` stays true for either so existing consumers
  // (page-header "N AI demos coming up", dashboard summary counts)
  // continue to treat AI prep work as a single bucket.
  const aiCategory = classifyAiLabel(issue);
  const isAiDemo = aiCategory !== null;
  if (aiCategory === 'demo') {
    status = 'AI Demo';
    tone = 'ai-demo';
  } else if (aiCategory === 'workshop') {
    status = 'AI Workshop';
    tone = 'ai-workshop';
  }
  const ae = extractAeName(issue.description);
  const dueDate = issue.dueDate || extractDescriptionField(issue.description, 'Due Date');
  const oppName = extractDescriptionField(issue.description, 'Opportunity Name');
  const typeOfAsk =
    extractDescriptionField(issue.description, 'Type of Ask') ||
    extractDescriptionField(issue.description, 'Main Ask');
  const accountScore = extractDescriptionField(issue.description, 'Account Score');

  // Linear priority is a 0–4 enum: 0 No priority, 1 Urgent, 2 High,
  // 3 Medium, 4 Low. Translate to the labels the frontend renders so
  // we don't leak the magic numbers into the UI layer.
  const PRIORITY_LABELS = {
    1: 'urgent',
    2: 'high',
    3: 'medium',
    4: 'low',
  };
  const priority = PRIORITY_LABELS[issue.priority] || null;

  return {
    id: issue.identifier || issue.id,
    title: issue.title,
    status,
    tone,
    ae: ae || null,
    dueDate: dueDate || null,
    oppName: oppName || null,
    typeOfAsk: typeOfAsk || null,
    accountScore: accountScore || null,
    priority,
    isAiDemo,
  };
}

/**
 * Resolve the Linear user UUID for an app user.
 * Auto-resolves from the user's email on first request and persists the result
 * to SalesEngineer.linearUserId so future requests skip the lookup.
 *
 * @param {string} userId  app User.id
 * @returns {Promise<
 *   | { status: 'ok', linearUserId: string, salesEngineer: object }
 *   | { status: 'no_sales_engineer' }
 *   | { status: 'needs_profile' }
 * >}
 */
async function loadOrResolveLinearUserId(userId) {
  const prisma = await getPrisma();
  const salesEngineer = await prisma.salesEngineer.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!salesEngineer) {
    return { status: 'no_sales_engineer' };
  }

  if (salesEngineer.linearUserId) {
    return {
      status: 'ok',
      linearUserId: salesEngineer.linearUserId,
      salesEngineer,
    };
  }

  const email = salesEngineer.user?.email;
  if (!email) {
    console.log('Linear: no email on user, cannot auto-resolve', { userId });
    return { status: 'needs_profile' };
  }

  const linearUser = await resolveLinearUserByEmail(email);
  if (!linearUser?.id) {
    console.log('Linear: no Linear user found for email, needs Profile setup', { email });
    return { status: 'needs_profile' };
  }

  const updated = await prisma.salesEngineer.update({
    where: { id: salesEngineer.id },
    data: { linearUserId: linearUser.id },
  });

  return {
    status: 'ok',
    linearUserId: linearUser.id,
    salesEngineer: { ...updated, user: salesEngineer.user },
  };
}

// Filter by state TYPE rather than an allowlist of state names. Linear
// teams routinely add custom states ("Needs Access Check", "Access
// Blocked", etc.) and even rename defaults ("To Do" vs "Todo"), so an
// explicit name allowlist silently drops tickets whenever a team's
// workflow drifts. The state types are a fixed enum (`triage`,
// `backlog`, `unstarted`, `started`, `completed`, `canceled`), so
// excluding the two terminal types is equivalent to "everything
// currently in flight" regardless of how a team named the state.
// `mapIssue` already redundantly filters completed/canceled client-side
// in case Linear ever returns one through this filter.
const TEAM_ISSUES_QUERY = `
  query MyTeamIssues($teamId: ID!, $assigneeId: ID!, $after: String) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        assignee: { id: { eq: $assigneeId } }
        state: { type: { nin: ["completed", "canceled"] } }
      }
      first: 100
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        description
        dueDate
        url
        priority
        state { name type }
        project { id name }
        labels { nodes { id name } }
      }
    }
  }
`;

const MAX_PAGES = 5;

async function fetchMyTeamIssues(linearUserId) {
  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId) {
    const err = new Error('LINEAR_TEAM_ID is not configured');
    err.statusCode = 503;
    throw err;
  }

  const all = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await linearGraphQL(TEAM_ISSUES_QUERY, {
      teamId,
      assigneeId: linearUserId,
      after,
    });
    const nodes = data?.issues?.nodes ?? [];
    all.push(...nodes);

    const pageInfo = data?.issues?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
      break;
    }
    after = pageInfo.endCursor;
  }
  return all;
}

// Internal / tooling-style Linear projects that should not appear in
// the SE "Active Hunts" dashboard. Match is case-insensitive and uses
// `includes` so partial names ("Create SE homepage in Mono - Repo")
// still match a short alias here. Edit this list to hide more projects.
const EXCLUDED_PROJECT_NAMES = [
  'gh - ratio estimate',
  'create se homepage',
  'pdf convertor',
  'pdf converter',
];

function isExcludedProjectName(name) {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return EXCLUDED_PROJECT_NAMES.some((excluded) => normalized.includes(excluded));
}

/**
 * Group raw Linear issue nodes by project.id, mapping each issue into the
 * { id, title, status, tone } shape the frontend widget expects.
 * Project-less issues are collected into a synthetic 'Other' bucket at the end.
 * Issues belonging to projects in EXCLUDED_PROJECT_NAMES are dropped entirely
 * so internal/tooling work doesn't crowd the AE-facing hunts view.
 *
 * @param {Array<object>} issues  raw Linear issue nodes
 * @returns {Array<{id: string, name: string, issues: object[]}>}
 */
function groupIssuesByProject(issues) {
  const byProject = new Map();
  let other = null;

  for (const issue of issues) {
    if (isExcludedProjectName(issue.project?.name)) continue;

    const mapped = mapIssue(issue);
    if (!mapped) continue;

    if (issue.project?.id) {
      const key = issue.project.id;
      let bucket = byProject.get(key);
      if (!bucket) {
        bucket = { id: key, name: issue.project.name || 'Untitled project', issues: [] };
        byProject.set(key, bucket);
      }
      bucket.issues.push(mapped);
    } else {
      if (!other) {
        other = { id: 'other', name: 'Other', issues: [] };
      }
      other.issues.push(mapped);
    }
  }

  const result = Array.from(byProject.values());
  if (other) {
    result.push(other);
  }
  return result;
}

// ---- Closed-ticket roll-up (team page "Tickets closed by you") -----------
//
// The team page surfaces, for the logged-in SE, how many Linear tickets they
// completed in a given calendar year, broken down by quarter and by ticket
// category (Estimation / Creation / Other) — see `classifyTicketTitle` for
// the title patterns. This lives next to the existing open-issues "Active
// Hunts" payload and does NOT compete with it (the open query explicitly
// excludes completed/canceled; this one only fetches completed).

// Classify a closed Linear issue into one of the four tracked
// categories. The order of checks matters — AI Demo wins over the
// estimation/creation title patterns because a demo ticket might
// happen to mention "Test Creation" in the title, and the demo is
// the more specific signal. Categories:
//   • aiDemo    — Carries an "AI Demo" or "AI Workshop" label, OR
//                 the title literally mentions "AI demo" /
//                 "AI workshop". We deliberately do NOT require the
//                 ticket to live in a CSM-named project — this rule
//                 must stay in lockstep with `classifyAiLabel` /
//                 `mapIssue` above (the rule the Active Hunts
//                 widget uses to badge a row "AI DEMO"), otherwise
//                 a ticket that visibly badges as AI Demo on the
//                 dashboard silently falls into "Other" on the
//                 team-page rollups.
//   • estimation — title matches any of the estimation naming
//                  conventions SEs have used over time:
//                    - "Exploratory Estimation" (e.g. "Ratio |
//                      Exploratory Estimation - {Opp}")
//                    - "Exploration Estimation" (drift from the
//                      "Exploratory" form — same work, different
//                      word; seen on tickets like "Exploration
//                      Estimation - Web for S-5")
//                    - "Ratio Estimation" (e.g. "Ratio Estimation -
//                      Web for FBN")
//                    - "Ratio Scope" / "Ratio Scoping" (e.g. "Ratio
//                      Scope for EON" — the scoping pass is the
//                      estimation work under a different name)
//                  All of these roll up into the same bucket.
//   • creation  — title contains "Test Creation - {Opp}".
//   • other     — anything else, so totals always reconcile.
const ESTIMATION_TITLE_RE =
  /(?:(?:exploratory|exploration)\s+estimation|ratio\s+(?:estimation|scoping|scope))/i;

// Word-boundaried so "main AI demonstration" or "domain AI work"
// can't false-match. `demos?` / `workshops?` so plural forms still
// classify the same as singular.
const AI_DEMO_TITLE_RE = /\bai\s+(?:demos?|workshops?)\b/i;

function classifyClosedIssue(issue) {
  // Reuse the same label-detection helper the Active Hunts widget
  // uses so the two surfaces always agree on what counts as an AI
  // Demo. Previously this had its own (stricter) rule that required
  // the ticket to live in a CSM-named project, which silently
  // dropped every AI demo ticket in a non-CSM project from the
  // per-AE rollup even though it was visibly badged "AI DEMO" on
  // the dashboard.
  const aiCategory = classifyAiLabel(issue);
  const title = typeof issue?.title === 'string' ? issue.title : '';

  // AI Demo classification: any AI Demo / AI Workshop label OR a
  // title hit. Checked up-front so a demo that mentions
  // "Test Creation" in the title still wins.
  if (aiCategory !== null || AI_DEMO_TITLE_RE.test(title)) {
    return 'aiDemo';
  }

  if (ESTIMATION_TITLE_RE.test(title)) return 'estimation';
  if (/test\s+creation/i.test(title)) return 'creation';
  return 'other';
}

// Map a Linear `completedAt` ISO string to the same "Q{n} CY{year}" key
// shape the Salesforce metrics report writes, so the team-page filter
// can compare ticket quarter against the existing scope key without any
// further normalization.
function quarterKeyOfDate(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${quarter} CY${year}`;
}

const CLOSED_TICKETS_QUERY = `
  query MyClosedTickets(
    $teamId: ID!
    $assigneeId: ID!
    $after: String
    $start: DateTimeOrDuration!
    $end: DateTimeOrDuration!
  ) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        assignee: { id: { eq: $assigneeId } }
        state: { type: { eq: "completed" } }
        completedAt: { gte: $start, lte: $end }
      }
      first: 100
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        url
        createdAt
        completedAt
        state { name type }
        project { id name }
        labels { nodes { id name } }
      }
    }
  }
`;

// Average creation→completion time in DAYS for a list of issues. We
// pick `createdAt` (lead time) over `startedAt` (cycle time) because
// SE tickets often skip the explicit "Started" state — the lead-time
// view is more honest about how long a request actually waits before
// it's done. Returns null for empty arrays so the frontend can render
// "no data" rather than a misleading "0 days".
function averageDaysToClose(issues) {
  const durationsMs = [];
  for (const issue of issues) {
    const created = issue.createdAt ? Date.parse(issue.createdAt) : NaN;
    const completed = issue.completedAt ? Date.parse(issue.completedAt) : NaN;
    if (Number.isNaN(created) || Number.isNaN(completed)) continue;
    const diff = completed - created;
    // Defensive: backdated tickets or clock skew can produce negative
    // durations. Skip rather than letting a single bad row drag the
    // average underwater.
    if (diff < 0) continue;
    durationsMs.push(diff);
  }
  if (!durationsMs.length) return null;
  const avgMs = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
  return avgMs / (1000 * 60 * 60 * 24);
}

async function fetchMyClosedTickets(linearUserId, year) {
  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId) {
    const err = new Error('LINEAR_TEAM_ID is not configured');
    err.statusCode = 503;
    throw err;
  }

  // Bracket the year in UTC so a Q4 ticket completed at 11pm Pacific
  // doesn't accidentally roll into next year's Q1 just because the
  // server happens to live in a different timezone.
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString();

  const all = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await linearGraphQL(CLOSED_TICKETS_QUERY, {
      teamId,
      assigneeId: linearUserId,
      after,
      start,
      end,
    });
    const nodes = data?.issues?.nodes ?? [];
    all.push(...nodes);

    const pageInfo = data?.issues?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return all;
}

// Short month labels used in the byMonth chart on the frontend.
// Indexed 1..12 so we can look up directly off the calendar month.
const SHORT_MONTH_NAMES = [
  '', // 0 — unused, keeps the array 1-indexed
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// The three calendar months that belong to a given quarter, in order.
// Q1 → [1,2,3], Q2 → [4,5,6], etc. Used to seed the byMonth array
// with a stable shape so the chart can render zero-bars for months
// the SE happened to close nothing in.
function monthsOfQuarter(quarter) {
  const start = (quarter - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

// Empty per-month bucket. Same category roster as the quarter buckets
// so the chart can render stacked bars without null-guarding for any
// missing category.
function emptyMonthBucket(month) {
  return {
    month,
    label: SHORT_MONTH_NAMES[month] || String(month),
    estimation: 0,
    creation: 0,
    aiDemo: 0,
    other: 0,
    total: 0,
  };
}

// Initialize an empty per-quarter bucket structure for a given year so
// the response always has the same shape, even when the SE has zero
// completed tickets that year — the frontend can iterate over quarters
// without null-guarding. `avgDays*` fields are null on empty buckets so
// the UI distinguishes "no data" from "closed in 0 days". `byMonth` is
// always pre-seeded with three zero-bars so the chart's x-axis is
// stable across quarters with sparse data.
function emptyQuarterlyBuckets(year) {
  const buckets = {};
  for (let q = 1; q <= 4; q += 1) {
    buckets[`Q${q} CY${year}`] = {
      quarter: q,
      estimation: 0,
      creation: 0,
      aiDemo: 0,
      other: 0,
      total: 0,
      avgDaysEstimation: null,
      avgDaysCreation: null,
      avgDaysAiDemo: null,
      avgDaysOther: null,
      avgDaysTotal: null,
      byMonth: monthsOfQuarter(q).map(emptyMonthBucket),
      // Detail rows for tickets in the catch-all "other" category, so
      // the frontend can render a disclosure listing them with links
      // back to Linear. Only populated for `other` because the named
      // categories already self-describe via the bar segments — we
      // only need to inspect the tickets that didn't match anything.
      otherTickets: [],
    };
  }
  return buckets;
}

/**
 * "Tickets closed by you" payload for the team page.
 *
 * Each quarter bucket carries category counts, a category-level
 * average lead time (createdAt → completedAt), and a `byMonth` array
 * of three monthly sub-buckets (one per calendar month of the
 * quarter). `avgDays*` fields are null when the bucket has no
 * closable durations so the UI can render "no data" instead of
 * "0 days".
 *
 * @param {string} userId  app User.id from req.user.id
 * @param {number} year    calendar year to roll up
 * @returns {Promise<{
 *   configured: boolean,
 *   year: number,
 *   byQuarter: Record<string, {
 *     quarter: number,
 *     estimation: number, creation: number, aiDemo: number,
 *     other: number, total: number,
 *     avgDaysEstimation: number|null, avgDaysCreation: number|null,
 *     avgDaysAiDemo: number|null, avgDaysOther: number|null,
 *     avgDaysTotal: number|null,
 *     byMonth: Array<{
 *       month: number, label: string,
 *       estimation: number, creation: number, aiDemo: number,
 *       other: number, total: number,
 *     }>,
 *     otherTickets: Array<{
 *       id: string, identifier: string|null, title: string,
 *       completedAt: string|null, url: string|null,
 *     }>,
 *   }>,
 *   total: {
 *     estimation: number, creation: number, aiDemo: number,
 *     other: number, total: number,
 *     avgDaysEstimation: number|null, avgDaysCreation: number|null,
 *     avgDaysAiDemo: number|null, avgDaysOther: number|null,
 *     avgDaysTotal: number|null,
 *   },
 *   reason?: 'no_sales_engineer',
 *   needsLinearProfile?: true,
 *   error?: 'linear_unavailable',
 * }>}
 */
export async function getClosedLinearTicketsForUser(userId, year) {
  const empty = {
    configured: false,
    year,
    byQuarter: emptyQuarterlyBuckets(year),
    total: {
      estimation: 0,
      creation: 0,
      aiDemo: 0,
      other: 0,
      total: 0,
      avgDaysEstimation: null,
      avgDaysCreation: null,
      avgDaysAiDemo: null,
      avgDaysOther: null,
      avgDaysTotal: null,
    },
  };

  const resolved = await loadOrResolveLinearUserId(userId);
  if (resolved.status === 'no_sales_engineer') {
    return { ...empty, reason: 'no_sales_engineer' };
  }
  if (resolved.status === 'needs_profile') {
    return { ...empty, needsLinearProfile: true };
  }

  try {
    const issues = await fetchMyClosedTickets(resolved.linearUserId, year);

    // First pass: bin the raw issues into per-quarter, per-category
    // arrays. We hold onto the full issue objects (not just counts)
    // because the second pass needs createdAt/completedAt to compute
    // averages — running the maths inline would force two iterations
    // anyway and would leak avg-tracking state into the loop.
    const grouped = {};
    const allByCategory = {
      estimation: [],
      creation: [],
      aiDemo: [],
      other: [],
    };
    for (const issue of issues) {
      const quarterKey = quarterKeyOfDate(issue.completedAt);
      if (!quarterKey) continue;
      if (!grouped[quarterKey]) {
        grouped[quarterKey] = {
          estimation: [],
          creation: [],
          aiDemo: [],
          other: [],
        };
      }
      const category = classifyClosedIssue(issue);
      grouped[quarterKey][category].push(issue);
      allByCategory[category].push(issue);
    }

    // Second pass: collapse each bucket into the count + avg shape
    // the frontend renders. Buckets the SE didn't touch this quarter
    // keep the empty defaults from `emptyQuarterlyBuckets` (including
    // the pre-seeded byMonth zero-bars).
    const byQuarter = emptyQuarterlyBuckets(year);
    for (const [quarterKey, bucket] of Object.entries(grouped)) {
      if (!byQuarter[quarterKey]) continue;
      const all = [...bucket.estimation, ...bucket.creation, ...bucket.aiDemo, ...bucket.other];

      // Build the byMonth array fresh from the empty seed so the
      // three months stay in chronological order even when the
      // grouping happened to populate them out of order.
      const quarter = byQuarter[quarterKey].quarter;
      const byMonth = monthsOfQuarter(quarter).map(emptyMonthBucket);
      const monthIndex = new Map(byMonth.map((m) => [m.month, m]));
      // Walk each issue in this quarter and increment the month
      // bucket it falls into. We classify per issue instead of
      // reusing `category` from the outer loop because the month
      // sub-totals need the same per-issue branching.
      for (const issue of all) {
        const completed = issue.completedAt ? new Date(issue.completedAt) : null;
        if (!completed || Number.isNaN(completed.getTime())) continue;
        const month = completed.getUTCMonth() + 1;
        const monthBucket = monthIndex.get(month);
        if (!monthBucket) continue;
        const cat = classifyClosedIssue(issue);
        monthBucket[cat] += 1;
        monthBucket.total += 1;
      }

      byQuarter[quarterKey] = {
        quarter,
        estimation: bucket.estimation.length,
        creation: bucket.creation.length,
        aiDemo: bucket.aiDemo.length,
        other: bucket.other.length,
        total: all.length,
        avgDaysEstimation: averageDaysToClose(bucket.estimation),
        avgDaysCreation: averageDaysToClose(bucket.creation),
        avgDaysAiDemo: averageDaysToClose(bucket.aiDemo),
        avgDaysOther: averageDaysToClose(bucket.other),
        avgDaysTotal: averageDaysToClose(all),
        byMonth,
        // Slim row shape (id/identifier/title/completedAt/url) so the
        // frontend can render a "Show N 'Other' tickets" disclosure
        // without us shipping the full Linear issue blob over the
        // wire. Sorted newest-first so the most recent unmatched
        // tickets surface at the top of the list.
        otherTickets: bucket.other
          .slice()
          .sort((a, b) => {
            const ta = a.completedAt ? Date.parse(a.completedAt) : 0;
            const tb = b.completedAt ? Date.parse(b.completedAt) : 0;
            return tb - ta;
          })
          .map((issue) => ({
            id: issue.id,
            identifier: issue.identifier || null,
            title: issue.title || '(untitled)',
            completedAt: issue.completedAt || null,
            url: issue.url || null,
          })),
      };
    }

    const allIssues = [
      ...allByCategory.estimation,
      ...allByCategory.creation,
      ...allByCategory.aiDemo,
      ...allByCategory.other,
    ];
    const total = {
      estimation: allByCategory.estimation.length,
      creation: allByCategory.creation.length,
      aiDemo: allByCategory.aiDemo.length,
      other: allByCategory.other.length,
      total: allIssues.length,
      avgDaysEstimation: averageDaysToClose(allByCategory.estimation),
      avgDaysCreation: averageDaysToClose(allByCategory.creation),
      avgDaysAiDemo: averageDaysToClose(allByCategory.aiDemo),
      avgDaysOther: averageDaysToClose(allByCategory.other),
      avgDaysTotal: averageDaysToClose(allIssues),
    };

    return { configured: true, year, byQuarter, total };
  } catch (err) {
    console.error('Linear: closed-ticket fetch failed for user', userId, '-', err.message);
    return { ...empty, error: 'linear_unavailable' };
  }
}

// ---- Tickets created BY AE (team page roll-up) ---------------------------
//
// Per-AE rollup of tickets created in a calendar year, keyed off the
// "Contract Owner" field in each ticket's description. Powers the team
// page's "Tickets created broken down by AE" section: for each AE on
// the team, how many tickets they've inputted this year/quarter,
// broken into Creation / Estimation / AI Demo / Other.
//
// Unlike `getClosedLinearTicketsForUser` (per-SE, per-completedAt),
// this query is team-wide and keyed on createdAt because the AE is
// the *requester*, not the assignee — we want every ticket they
// submitted, regardless of which SE picked it up or whether it's
// closed yet.

const TEAM_TICKETS_CREATED_QUERY = `
  query TeamTicketsCreated(
    $teamId: ID!
    $after: String
    $start: DateTimeOrDuration!
    $end: DateTimeOrDuration!
  ) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        createdAt: { gte: $start, lte: $end }
      }
      first: 100
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        description
        url
        createdAt
        assignee { id }
        project { id name }
        labels { nodes { id name } }
      }
    }
  }
`;

// Higher cap than the per-SE queries: a whole team's worth of tickets
// over a year can run into the low thousands. 30 pages × 100 = 3,000
// tickets, which is well above any team's observed annual volume but
// still bounded so a runaway pagination loop can't pin the worker.
const MAX_TEAM_TICKETS_PAGES = 30;

async function fetchTeamTicketsCreated(year) {
  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId) {
    const err = new Error('LINEAR_TEAM_ID is not configured');
    err.statusCode = 503;
    throw err;
  }

  // UTC bracketing matches `fetchMyClosedTickets` so a ticket created
  // late on Dec 31 Pacific doesn't slip into the next year's bucket
  // depending on where the worker happens to live.
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString();

  const all = [];
  let after = null;
  for (let page = 0; page < MAX_TEAM_TICKETS_PAGES; page += 1) {
    const data = await linearGraphQL(TEAM_TICKETS_CREATED_QUERY, {
      teamId,
      after,
      start,
      end,
    });
    const nodes = data?.issues?.nodes ?? [];
    all.push(...nodes);

    const pageInfo = data?.issues?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return all;
}

// Empty per-AE bucket. Same category roster as the closed-ticket
// payload above so the frontend can iterate both responses with the
// same loop.
function emptyAeBucket(aeName) {
  return {
    aeName,
    total: 0,
    estimation: 0,
    creation: 0,
    aiDemo: 0,
    other: 0,
    byQuarter: {},
  };
}

function emptyAeQuarterBucket() {
  return {
    total: 0,
    estimation: 0,
    creation: 0,
    aiDemo: 0,
    other: 0,
  };
}

// Empty unassigned bucket. Same category roster as the per-AE buckets
// plus a `tickets` array of slim row shapes so the frontend can
// render a clickable list of tickets that need AE attribution.
function emptyUnassignedBucket() {
  return {
    total: 0,
    estimation: 0,
    creation: 0,
    aiDemo: 0,
    other: 0,
    byQuarter: {},
    tickets: [],
  };
}

/**
 * Tickets-created-by-AE roll-up for the team page.
 *
 * Walks every ticket in LINEAR_TEAM_ID created in the given calendar
 * year, extracts the AE / Contract Owner field from each description,
 * and aggregates per AE. Tickets without a recognizable AE are
 * collected in a separate `unassigned` bucket — but ONLY if the
 * Linear assignee matches the team's SE (the logged-in user). Multiple
 * SE teams share the same Linear team, so an unfiltered unassigned
 * bucket would bleed every other team's unattributed tickets onto
 * this team's page. The per-AE buckets don't need this filter
 * because the AE field itself implicitly scopes them — a ticket
 * with AE = "Chris Burke" is Team Yoshi's by virtue of Chris
 * being on Team Yoshi's roster.
 *
 * Tickets in EXCLUDED_PROJECT_NAMES are skipped entirely — those
 * are internal/tooling projects and shouldn't count toward any AE's
 * input or the unassigned bucket.
 *
 * Returns `{ byAE: { [normalizedName]: bucket }, unassigned: bucket }`
 * — `byAE` keyed by normalized name so the frontend can do
 * constant-time lookups when matching the team's `accountExecutives`
 * roster against the rollup. Each bucket carries year totals AND a
 * `byQuarter` map keyed on the same "Q{n} CY{year}" shape the report
 * writes, so the team page's year/current-quarter scope toggle can
 * pick whichever slice it needs without a second request.
 *
 * @param {number} year
 * @returns {Promise<{
 *   configured: boolean,
 *   year: number,
 *   byAE: Record<string, {
 *     aeName: string,
 *     total: number, estimation: number, creation: number,
 *     aiDemo: number, other: number,
 *     byQuarter: Record<string, {
 *       total: number, estimation: number, creation: number,
 *       aiDemo: number, other: number,
 *     }>,
 *   }>,
 *   unassigned: {
 *     total: number, estimation: number, creation: number,
 *     aiDemo: number, other: number,
 *     byQuarter: Record<string, { total: number, ... }>,
 *     tickets: Array<{
 *       id: string, identifier: string|null, title: string,
 *       createdAt: string|null, url: string|null,
 *       category: 'estimation' | 'creation' | 'aiDemo' | 'other',
 *     }>,
 *   },
 *   error?: 'linear_unavailable',
 * }>}
 */
export async function getTicketsCreatedByAEForTeam(userId, year) {
  const empty = {
    configured: false,
    year,
    byAE: {},
    unassigned: emptyUnassignedBucket(),
  };

  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId) return empty;

  // Resolve the SE's Linear user ID so we can scope the unassigned
  // bucket to "tickets this team's SE picked up". When we can't
  // resolve (no SE row, no Linear profile match), the unassigned
  // bucket stays empty rather than leaking the global pool — better
  // a zero-state hint than the wrong number.
  const resolved = await loadOrResolveLinearUserId(userId);
  const seLinearUserId = resolved.status === 'ok' ? resolved.linearUserId : null;

  try {
    const issues = await fetchTeamTicketsCreated(year);

    const byAE = {};
    const unassigned = emptyUnassignedBucket();
    for (const issue of issues) {
      if (isExcludedProjectName(issue.project?.name)) continue;

      const category = classifyClosedIssue(issue);
      const quarterKey = quarterKeyOfDate(issue.createdAt);
      const ae = extractAeName(issue.description);

      if (!ae) {
        // Tickets with no recognizable AE field fall into the
        // `unassigned` bucket — but only if the Linear assignee
        // matches this team's SE. Without that filter, every team's
        // page would show every other team's unattributed tickets
        // because they all share one Linear team. When we couldn't
        // resolve the SE's Linear ID at all, drop everything to
        // avoid leaking the global pool.
        if (!seLinearUserId) continue;
        if (issue.assignee?.id !== seLinearUserId) continue;

        // Slim row shape (id/identifier/title/url/category) so the
        // frontend can render a click-through list of "go attribute
        // these" tickets without us shipping the full description
        // blob.
        unassigned[category] += 1;
        unassigned.total += 1;
        if (quarterKey) {
          if (!unassigned.byQuarter[quarterKey]) {
            unassigned.byQuarter[quarterKey] = emptyAeQuarterBucket();
          }
          unassigned.byQuarter[quarterKey][category] += 1;
          unassigned.byQuarter[quarterKey].total += 1;
        }
        unassigned.tickets.push({
          id: issue.id,
          identifier: issue.identifier || null,
          title: issue.title || '(untitled)',
          createdAt: issue.createdAt || null,
          url: issue.url || null,
          category,
        });
        continue;
      }

      // Normalize the same way `groupOppsByAE` does on the frontend
      // (lowercase + trim) so the team page can match this map's keys
      // against `team.accountExecutives` without any further munging.
      const aeKey = ae.trim().toLowerCase();
      if (!aeKey) continue;
      if (!byAE[aeKey]) byAE[aeKey] = emptyAeBucket(ae.trim());

      byAE[aeKey][category] += 1;
      byAE[aeKey].total += 1;

      if (quarterKey) {
        if (!byAE[aeKey].byQuarter[quarterKey]) {
          byAE[aeKey].byQuarter[quarterKey] = emptyAeQuarterBucket();
        }
        byAE[aeKey].byQuarter[quarterKey][category] += 1;
        byAE[aeKey].byQuarter[quarterKey].total += 1;
      }
    }

    // Sort the unassigned ticket list newest-first so the disclosure
    // surfaces the most recently submitted tickets at the top — fresh
    // tickets are almost always the ones the SE wants to fix first.
    unassigned.tickets.sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });

    return { configured: true, year, byAE, unassigned };
  } catch (err) {
    console.error('Linear: tickets-by-AE fetch failed -', err.message);
    return { ...empty, error: 'linear_unavailable' };
  }
}

// -------------------------------------------------------------------------
// Opp-page helper: find every Linear ticket whose title or description
// references a given Opportunity Name, regardless of who owns it. Used by
// the Opp handoff page so a Lead can see the full constellation of work
// (estimation, creation, AI demo prep, misc) in one card without having
// to dig through Linear filters.
// -------------------------------------------------------------------------

const OPP_TICKETS_QUERY = `
  query OppTickets($teamId: ID!, $needle: String!, $after: String) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        or: [
          { title: { containsIgnoreCase: $needle } }
          { description: { containsIgnoreCase: $needle } }
        ]
      }
      first: 100
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        description
        url
        priority
        dueDate
        createdAt
        completedAt
        state { name type }
        project { id name }
        assignee { id name email }
        labels { nodes { id name } }
      }
    }
  }
`;

// Categorize a ticket for the Opp page. Reuses the same title regexes as
// the team-page roll-up so naming stays consistent across surfaces.
//   creation  -> "Test Creation - ..."
//   scope     -> "Exploratory Estimation" / "Ratio Estimation"
//   aiDemo    -> AI Demo / AI Workshop labels or matching title
//   other     -> everything else (intro calls, follow-ups, ad-hoc work)
function categorizeOppTicket(issue) {
  const labels = Array.isArray(issue?.labels?.nodes) ? issue.labels.nodes : [];
  const hasAiDemoLabel = labels.some((label) =>
    /^ai\s*(?:demo|workshop)$/i.test((label?.name || '').trim()),
  );
  const title = typeof issue?.title === 'string' ? issue.title : '';
  if (hasAiDemoLabel || AI_DEMO_TITLE_RE.test(title)) return 'aiDemo';
  if (ESTIMATION_TITLE_RE.test(title)) return 'scope';
  if (/test\s+creation/i.test(title)) return 'creation';
  return 'other';
}

// A ticket "really" matches an Opportunity Name when:
//   - the description contains the explicit `Opportunity Name: {name}` line, OR
//   - the title contains the name (case-insensitive).
// We post-filter the GraphQL response because `containsIgnoreCase` matches
// any substring anywhere -- e.g. the name "Acme" would otherwise pull in
// every ticket that happened to mention "acme" in passing. Restricting to
// the labeled description field and title keeps the card honest.
function isStrongOppMatch(issue, oppName) {
  if (!oppName) return false;
  const normalized = oppName.trim().toLowerCase();
  if (!normalized) return false;
  const title = (issue.title || '').toLowerCase();
  if (title.includes(normalized)) return true;
  const fromField = extractDescriptionField(issue.description, 'Opportunity Name');
  if (fromField && fromField.toLowerCase() === normalized) return true;
  return false;
}

// Pull the Slack thread URL out of a Linear ticket description. AE-request
// tickets created from Slack include a "Slack Thread: <url>" line in the
// labeled body. We accept either the labeled-field form or a bare Slack
// URL found anywhere in the description so we don't miss tickets where
// the template was hand-edited.
function extractSlackThread(description) {
  if (!description || typeof description !== 'string') return null;
  const labeled = extractDescriptionField(description, 'Slack Thread');
  if (labeled) {
    const m = labeled.match(/https?:\/\/[^\s)>\]]+/);
    if (m) return m[0];
  }
  const fallback = description.match(/https?:\/\/[a-z0-9-]+\.slack\.com\/[^\s)>\]]+/i);
  return fallback ? fallback[0] : null;
}

// Extract the AE-template "Type of Ask" field. Used by the Opp detail
// page to auto-pre-select the Estimation Type radio when a scoping ticket
// is linked. Falls back to "Main Ask" since older templates used that.
function extractTypeOfAsk(description) {
  if (!description) return null;
  return (
    extractDescriptionField(description, 'Type of Ask') ||
    extractDescriptionField(description, 'Main Ask') ||
    null
  );
}

function mapOppTicket(issue) {
  const state = issue.state || {};
  const isClosed = ['completed', 'canceled'].includes((state.type || '').toLowerCase());
  return {
    id: issue.identifier || issue.id,
    rawId: issue.id,
    title: issue.title,
    url: issue.url || null,
    state: state.name || null,
    stateType: state.type || null,
    isClosed,
    priority: issue.priority ?? null,
    dueDate: issue.dueDate || null,
    createdAt: issue.createdAt || null,
    completedAt: issue.completedAt || null,
    project: issue.project?.name || null,
    assignee: issue.assignee
      ? {
          name: issue.assignee.name || null,
          email: issue.assignee.email || null,
        }
      : null,
    labels: Array.isArray(issue.labels?.nodes)
      ? issue.labels.nodes.map((l) => l?.name).filter(Boolean)
      : [],
    // Auto-extracted from the ticket description. Surfaced on the Opp
    // page so the SE can jump from a Creation / Scope ticket straight to
    // the AE's Slack request thread without round-tripping through Linear.
    slackThread: extractSlackThread(issue.description),
    typeOfAsk: extractTypeOfAsk(issue.description),
  };
}

/**
 * Fetch every Linear ticket in the configured team that references the given
 * opportunity name, grouped by Opp-page category. Used by GET /opps/:id to
 * render the "Linked Linear tickets" card. Returns an empty shape when Linear
 * isn't configured rather than throwing, so the Opp page still renders.
 *
 * @param {string} oppName
 * @returns {Promise<{
 *   configured: boolean,
 *   creation: object[], scope: object[], aiDemo: object[], other: object[],
 *   total: number,
 * }>}
 */
export async function findLinearTicketsForOpp(oppName) {
  const empty = {
    configured: false,
    creation: [],
    scope: [],
    aiDemo: [],
    other: [],
    total: 0,
  };

  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId || !process.env.LINEAR_API_KEY?.trim()) return empty;
  if (!oppName?.trim()) return { ...empty, configured: true };

  const needle = oppName.trim();
  const all = [];
  let after = null;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await linearGraphQL(OPP_TICKETS_QUERY, { teamId, needle, after });
      const nodes = data?.issues?.nodes ?? [];
      all.push(...nodes);
      const pageInfo = data?.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      after = pageInfo.endCursor;
    }
  } catch (err) {
    console.error('Linear: opp ticket lookup failed for', oppName, '-', err.message);
    return { ...empty, configured: true };
  }

  const buckets = { creation: [], scope: [], aiDemo: [], other: [] };
  for (const issue of all) {
    if (!isStrongOppMatch(issue, oppName)) continue;
    const cat = categorizeOppTicket(issue);
    buckets[cat].push(mapOppTicket(issue));
  }

  // Sort each bucket: open before closed, then newest first by createdAt.
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => {
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
  }

  const total =
    buckets.creation.length + buckets.scope.length + buckets.aiDemo.length + buckets.other.length;

  return { configured: true, ...buckets, total };
}

// ---------------------------------------------------------------------------
// Manual Linear-ticket lookup (for SEs adding mis-named tickets by hand).
// ---------------------------------------------------------------------------

// Lookup by issue identifier (e.g. "AXO-959"). Linear's GraphQL has a direct
// `issueVcsBranchSearch` -- but the simpler and more reliable approach is to
// filter the team's issues by `number` after extracting the prefix/number
// from the identifier. We restrict to LINEAR_TEAM_ID so a stray "ABC-123"
// from a different team can't be linked into our Opp.
const ISSUE_BY_NUMBER_QUERY = `
  query IssueByNumber($teamId: ID!, $number: Float!) {
    issues(filter: { team: { id: { eq: $teamId } }, number: { eq: $number } }, first: 1) {
      nodes {
        id
        identifier
        title
        description
        url
        priority
        dueDate
        createdAt
        completedAt
        state { name type }
        project { id name }
        assignee { id name email }
        labels { nodes { id name } }
      }
    }
  }
`;

// Accept either a bare identifier ("AXO-959") or a full Linear URL
// ("https://linear.app/qawolf/issue/AXO-959/some-slug") and normalize to
// `{ prefix, number }`. Returns null when nothing identifier-shaped is
// found in the input.
export function parseLinearIdentifier(input) {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.trim();
  if (!cleaned) return null;
  // Match the prefix-number pattern wherever it appears in the string so
  // pasting a URL just works without the SE stripping the slug.
  const match = cleaned.match(/([A-Z][A-Z0-9]{0,9})-(\d+)/);
  if (!match) return null;
  return {
    identifier: `${match[1].toUpperCase()}-${match[2]}`,
    prefix: match[1].toUpperCase(),
    number: Number(match[2]),
  };
}

/**
 * Fetch a single Linear ticket by identifier (e.g. "AXO-959"). Used by the
 * manual-link endpoint so we can (a) validate the ticket exists before
 * persisting and (b) hydrate display state for the UI.
 *
 * @param {string} identifier  Bare identifier or full Linear URL.
 * @returns {Promise<{ status: 'ok', ticket: object } | { status: 'not_configured' | 'invalid' | 'not_found' | 'error', message?: string }>}
 */
export async function getLinearTicketByIdentifier(identifier) {
  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId || !process.env.LINEAR_API_KEY?.trim()) {
    return { status: 'not_configured' };
  }
  const parsed = parseLinearIdentifier(identifier);
  if (!parsed) {
    return { status: 'invalid', message: 'Could not parse a Linear ticket identifier from input.' };
  }
  try {
    const data = await linearGraphQL(ISSUE_BY_NUMBER_QUERY, {
      teamId,
      number: parsed.number,
    });
    const issue = data?.issues?.nodes?.[0];
    if (!issue) return { status: 'not_found' };
    // Guard against same-number tickets in a different team prefix. The
    // GraphQL filter is already scoped by team, but checking identifier
    // is a cheap belt-and-braces.
    if (issue.identifier && issue.identifier !== parsed.identifier) {
      return { status: 'not_found' };
    }
    return { status: 'ok', ticket: mapOppTicket(issue) };
  } catch (err) {
    console.error('Linear: ticket lookup failed for', parsed.identifier, '-', err.message);
    return { status: 'error', message: err.message };
  }
}

/**
 * Resolve a list of manually-linked Linear identifiers and merge them into
 * a `findLinearTicketsForOpp` result. Manually-linked tickets are flagged
 * with `manual: true` so the UI can render an unlink affordance; duplicates
 * (a ticket that's both auto-discovered and manually linked) are deduped on
 * `rawId` with the auto-discovered entry winning -- but still flagged
 * `manual: true` so the SE can unlink it.
 *
 * Tickets that no longer exist in Linear (deleted, archived to oblivion, or
 * accessible to a user who lacks permission) are silently dropped from the
 * returned buckets but still included in `unresolved` so the UI can surface
 * the dangling identifier.
 *
 * @param {ReturnType<findLinearTicketsForOpp>} baseBuckets
 * @param {string[]} identifiers
 */
export async function mergeManualLinearLinks(baseBuckets, identifiers) {
  if (!Array.isArray(identifiers) || identifiers.length === 0) {
    return { ...baseBuckets, manualIdentifiers: [], unresolved: [] };
  }
  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId || !process.env.LINEAR_API_KEY?.trim()) {
    return {
      ...baseBuckets,
      manualIdentifiers: identifiers,
      unresolved: identifiers,
    };
  }

  // De-dupe + normalize identifiers up front so a sloppy double-link
  // doesn't fire two GraphQL calls.
  const seen = new Set();
  const normalized = [];
  for (const raw of identifiers) {
    const parsed = parseLinearIdentifier(raw);
    if (!parsed) continue;
    if (seen.has(parsed.identifier)) continue;
    seen.add(parsed.identifier);
    normalized.push(parsed.identifier);
  }

  const results = await Promise.all(normalized.map((id) => getLinearTicketByIdentifier(id)));

  // Index existing auto-discovered tickets so we can flag those that are
  // *also* manually linked rather than duplicating them.
  const byRawId = new Map();
  for (const cat of ['creation', 'scope', 'aiDemo', 'other']) {
    for (const t of baseBuckets[cat] || []) {
      if (t.rawId) byRawId.set(t.rawId, t);
    }
  }

  const buckets = {
    creation: [...(baseBuckets.creation || [])],
    scope: [...(baseBuckets.scope || [])],
    aiDemo: [...(baseBuckets.aiDemo || [])],
    other: [...(baseBuckets.other || [])],
  };
  const unresolved = [];

  results.forEach((res, i) => {
    const identifier = normalized[i];
    if (res.status !== 'ok' || !res.ticket) {
      unresolved.push(identifier);
      return;
    }
    const ticket = { ...res.ticket, manual: true };
    const existing = byRawId.get(ticket.rawId);
    if (existing) {
      existing.manual = true;
      return;
    }
    // Re-categorize by title so manual links land in the right bucket.
    // We don't have the raw `issue` object here, but mapOppTicket preserved
    // the title and labels (via the bucket structure) -- categorizeOppTicket
    // takes the raw shape, so we fake one with just the fields it inspects.
    const cat = categorizeOppTicket({
      title: ticket.title,
      labels: { nodes: (ticket.labels || []).map((name) => ({ name })) },
    });
    buckets[cat].push(ticket);
  });

  // Re-sort buckets (open above closed, newest first) so manual additions
  // slot into the right position rather than appearing at the bottom.
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => {
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
  }

  const total =
    buckets.creation.length + buckets.scope.length + buckets.aiDemo.length + buckets.other.length;

  return {
    ...baseBuckets,
    ...buckets,
    total,
    manualIdentifiers: normalized,
    unresolved,
  };
}

// Dedicated picker query -- mirrors TEAM_ISSUES_QUERY but adds the extra
// fields mapOppTicket() expects (assignee + createdAt) so the picker can
// show "assigned to X, created Y" hints without a second fetch.
const PICKER_ISSUES_QUERY = `
  query MyPickerIssues($teamId: ID!, $assigneeId: ID!, $after: String) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        assignee: { id: { eq: $assigneeId } }
        state: { type: { nin: ["completed", "canceled"] } }
      }
      first: 100
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        url
        priority
        dueDate
        createdAt
        completedAt
        state { name type }
        project { id name }
        assignee { id name email }
        labels { nodes { id name } }
      }
    }
  }
`;

/**
 * Return the logged-in SE's currently-open Linear tickets in the same shape
 * `findLinearTicketsForOpp` uses, so the manual-link picker can render
 * them with familiar fields (identifier, title, state, project, etc.).
 *
 * Intentionally broader than the dashboard's "Active Hunts" view -- we
 * don't filter out internal projects or non-opportunity tickets, because
 * the SE explicitly knows which ticket they're trying to link.
 */
export async function listMyOpenLinearTickets(userId) {
  const empty = { configured: false, tickets: [] };
  const teamId = process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId || !process.env.LINEAR_API_KEY?.trim()) return empty;

  const resolved = await loadOrResolveLinearUserId(userId);
  if (resolved.status === 'no_sales_engineer') {
    return { ...empty, configured: true, reason: 'no_sales_engineer' };
  }
  if (resolved.status === 'needs_profile') {
    return { ...empty, configured: true, needsLinearProfile: true };
  }

  const all = [];
  let after = null;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await linearGraphQL(PICKER_ISSUES_QUERY, {
        teamId,
        assigneeId: resolved.linearUserId,
        after,
      });
      const nodes = data?.issues?.nodes ?? [];
      all.push(...nodes);
      const pageInfo = data?.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      after = pageInfo.endCursor;
    }
  } catch (err) {
    console.error('Linear: my-tickets fetch failed for user', userId, '-', err.message);
    return { ...empty, configured: true };
  }

  const tickets = all.map(mapOppTicket);

  // Newest first -- recently-created tickets are far more likely to be
  // the one the SE is hunting for.
  tickets.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });

  return { configured: true, tickets };
}

/**
 * Group the current SE's open AE Request tickets by `Opportunity Name:` so
 * the "My Opps" page can list one card per opp without forcing the SE to
 * create a DB row first. Falls back to `{ configured: false, groups: [] }`
 * when the user has no SalesEngineer record / Linear isn't wired up.
 *
 * @param {string} userId  app User.id
 * @returns {Promise<{
 *   configured: boolean,
 *   reason?: 'no_sales_engineer',
 *   needsLinearProfile?: true,
 *   groups: Array<{ oppName: string, tickets: object[] }>,
 * }>}
 */
export async function getMyOppNamesFromLinear(userId) {
  const empty = { configured: false, groups: [] };
  const resolved = await loadOrResolveLinearUserId(userId);
  if (resolved.status === 'no_sales_engineer') {
    return { ...empty, reason: 'no_sales_engineer' };
  }
  if (resolved.status === 'needs_profile') {
    return { ...empty, needsLinearProfile: true };
  }

  let issues = [];
  try {
    issues = await fetchMyTeamIssues(resolved.linearUserId);
  } catch (err) {
    console.error('Linear: my-opps fetch failed for user', userId, '-', err.message);
    return empty;
  }

  // Bucket by Opportunity Name. Tickets that don't have one (or live in an
  // excluded project) are skipped so the list stays focused on real opps.
  const byName = new Map();
  for (const issue of issues) {
    if (isExcludedProjectName(issue.project?.name)) continue;
    const oppName = extractDescriptionField(issue.description, 'Opportunity Name');
    if (!oppName) continue;
    if (!byName.has(oppName)) byName.set(oppName, []);
    byName.get(oppName).push(mapOppTicket(issue));
  }

  const groups = Array.from(byName.entries())
    .map(([oppName, tickets]) => ({ oppName, tickets }))
    .sort((a, b) => a.oppName.localeCompare(b.oppName));

  return { configured: true, groups };
}

/**
 * Per-user dashboard payload.
 * @param {string} userId  app User.id from req.user.id
 * @returns {Promise<{
 *   configured: boolean,
 *   openUrl: string,
 *   projects: Array<{id: string, name: string, issues: object[]}>,
 *   reason?: 'no_sales_engineer',
 *   needsLinearProfile?: true,
 *   error?: 'linear_unavailable',
 * }>}
 */
export async function getLinearBoardForDashboardForUser(userId) {
  const openUrl = (process.env.LINEAR_APP_URL || 'https://linear.app').replace(/\/$/, '');

  const resolved = await loadOrResolveLinearUserId(userId);

  if (resolved.status === 'no_sales_engineer') {
    return { configured: false, reason: 'no_sales_engineer', openUrl, projects: [] };
  }

  if (resolved.status === 'needs_profile') {
    return { configured: false, needsLinearProfile: true, openUrl, projects: [] };
  }

  try {
    const issues = await fetchMyTeamIssues(resolved.linearUserId);
    const projects = groupIssuesByProject(issues);
    return { configured: true, openUrl, projects };
  } catch (err) {
    console.error('Linear: fetch failed for user', userId, '-', err.message);
    return { configured: false, error: 'linear_unavailable', openUrl, projects: [] };
  }
}
