/**
 * Per-user Linear "workload" for the dashboard.
 * Returns the logged-in user's open issues in LINEAR_TEAM_ID, grouped by project.
 * Env: LINEAR_API_KEY, LINEAR_TEAM_ID, optional LINEAR_APP_URL
 */

import { getPrisma } from '../lib/prisma.js';
import { resolveLinearUserByEmail, linearGraphQL } from '../lib/linearClient.js';

function mapIssue(issue) {
  const state = issue.state;
  if (!state) {
    return {
      id: issue.identifier || issue.id,
      title: issue.title,
      status: 'Backlog',
      tone: 'backlog',
    };
  }

  const type = (state.type || '').toLowerCase();
  const name = (state.name || '').toLowerCase();

  if (type === 'completed' || type === 'canceled') {
    return null;
  }

  if (name.includes('review')) {
    return {
      id: issue.identifier || issue.id,
      title: issue.title,
      status: state.name || 'In review',
      tone: 'review',
    };
  }

  if (type === 'started') {
    return {
      id: issue.identifier || issue.id,
      title: issue.title,
      status: state.name || 'In progress',
      tone: 'progress',
    };
  }

  if (type === 'unstarted' || type === 'backlog') {
    return {
      id: issue.identifier || issue.id,
      title: issue.title,
      status: state.name || 'Backlog',
      tone: 'backlog',
    };
  }

  return {
    id: issue.identifier || issue.id,
    title: issue.title,
    status: state.name || 'Backlog',
    tone: 'backlog',
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
        url
        priority
        state { name type }
        project { id name }
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

/**
 * Group raw Linear issue nodes by project.id, mapping each issue into the
 * { id, title, status, tone } shape the frontend widget expects.
 * Project-less issues are collected into a synthetic 'Other' bucket at the end.
 *
 * @param {Array<object>} issues  raw Linear issue nodes
 * @returns {Array<{id: string, name: string, issues: object[]}>}
 */
function groupIssuesByProject(issues) {
  const byProject = new Map();
  let other = null;

  for (const issue of issues) {
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
