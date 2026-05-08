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
  const ae = extractDescriptionField(issue.description, 'Contract Owner');
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
//   • aiDemo    — EITHER lives in a CSM-named project AND carries
//                 the "AI Demo" label, OR the title literally
//                 mentions "AI demo" / "AI workshop" (so demo
//                 tickets that didn't get the CSM-project + label
//                 combo still classify correctly).
//   • estimation — title mentions "Exploratory Estimation" (e.g.
//                  "Ratio | Exploratory Estimation - {Opp}") OR
//                  "Ratio Estimation" (e.g. "Ratio Estimation -
//                  Web for FBN"). Both flavours are estimation
//                  work and roll up into the same bucket.
//   • creation  — title contains "Test Creation - {Opp}".
//   • other     — anything else, so totals always reconcile.
const ESTIMATION_TITLE_RE = /(?:exploratory|ratio)\s+estimation/i;

// Word-boundaried so "main AI demonstration" or "domain AI work"
// can't false-match. `demos?` / `workshops?` so plural forms still
// classify the same as singular.
const AI_DEMO_TITLE_RE = /\bai\s+(?:demos?|workshops?)\b/i;

function classifyClosedIssue(issue) {
  const projectName = issue?.project?.name || '';
  const labels = Array.isArray(issue?.labels?.nodes) ? issue.labels.nodes : [];
  // Mirrors AI_DEMO_LABEL_RE above — "AI Workshop" is treated as the
  // same category as "AI Demo" for the team-page roll-up so a CSM
  // workshop ticket counts toward the AI Demo bucket rather than
  // landing in "Other".
  const hasAiDemoLabel = labels.some((label) =>
    /^ai\s*(?:demo|workshop)$/i.test((label?.name || '').trim()),
  );
  const isCsmProject = /csm/i.test(projectName);

  const title = typeof issue?.title === 'string' ? issue.title : '';

  // AI Demo classification: either the project + label combo OR a
  // title hit. We check both up-front so a demo that mentions
  // "Test Creation" in the title still wins.
  if ((hasAiDemoLabel && isCsmProject) || AI_DEMO_TITLE_RE.test(title)) {
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
