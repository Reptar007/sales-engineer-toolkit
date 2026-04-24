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

// Special-case label that elevates an issue to its own visual treatment
// in the dashboard. When present, the row is highlighted pink and its
// Status pill is replaced with "AI Demo" so the SE can spot demo work
// at a glance regardless of where it sits in the workflow.
const AI_DEMO_LABEL_RE = /^ai\s*demo$/i;

function hasAiDemoLabel(issue) {
  const nodes = issue?.labels?.nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some((label) => AI_DEMO_LABEL_RE.test((label?.name || '').trim()));
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
  const isAiDemo = hasAiDemoLabel(issue);
  if (isAiDemo) {
    status = 'AI Demo';
    tone = 'ai-demo';
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

const TEAM_ISSUES_QUERY = `
  query MyTeamIssues($teamId: ID!, $assigneeId: ID!, $after: String) {
    issues(
      filter: {
        team: { id: { eq: $teamId } }
        assignee: { id: { eq: $assigneeId } }
        state: {
          name: {
            in: [
              "Blocked",
              "Paused",
              "In Progress",
              "Needs Access Check",
              "Access Check Completed",
              "Access Blocked",
              "To Do",
              "Backlog"
            ]
          }
        }
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
