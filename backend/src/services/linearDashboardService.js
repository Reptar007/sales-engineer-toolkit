/**
 * Linear GraphQL for dashboard "workload" grouped by project.
 * Env: LINEAR_API_KEY, LINEAR_PROJECT_AE_REQUESTS_ID, LINEAR_PROJECT_CREATIONS_TASKS_ID,
 *      LINEAR_PROJECT_CSM_REQUESTS_ID (Linear project UUIDs)
 */

const LINEAR_GQL = 'https://api.linear.app/graphql';

const PROJECT_DEFS = [
  { id: 'ae-requests', envKey: 'LINEAR_PROJECT_AE_REQUESTS_ID', name: 'AE Requests' },
  { id: 'creations-tasks', envKey: 'LINEAR_PROJECT_CREATIONS_TASKS_ID', name: 'Creations Tasks' },
  { id: 'csm-requests', envKey: 'LINEAR_PROJECT_CSM_REQUESTS_ID', name: 'CSM Requests' },
];

const ISSUES_QUERY = `
  query DashboardProjectIssues($projectId: String!) {
    project(id: $projectId) {
      id
      name
      issues(first: 40) {
        nodes {
          id
          identifier
          title
          state {
            name
            type
          }
        }
      }
    }
  }
`;

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

async function linearRequest(apiKey, query, variables) {
  const res = await fetch(LINEAR_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.errors?.[0]?.message || `Linear HTTP ${res.status}`);
  }
  if (body.errors?.length) {
    throw new Error(body.errors[0].message || 'Linear GraphQL error');
  }
  return body.data;
}

async function fetchProjectIssues(apiKey, linearProjectId) {
  if (!linearProjectId?.trim()) {
    return [];
  }
  const data = await linearRequest(apiKey, ISSUES_QUERY, { projectId: linearProjectId.trim() });
  const project = data?.project;
  if (!project) {
    return [];
  }
  const nodes = project.issues?.nodes || [];
  return nodes.map(mapIssue).filter(Boolean);
}

/**
 * @returns {Promise<{ configured: boolean, openUrl: string, projects: Array<{id: string, name: string, issues: object[]}> }>}
 */
export async function getLinearBoardForDashboard() {
  const apiKey = process.env.LINEAR_API_KEY?.trim();
  const openUrl = (process.env.LINEAR_APP_URL || 'https://linear.app').replace(/\/$/, '');

  const baseProjects = PROJECT_DEFS.map((p) => ({
    id: p.id,
    name: p.name,
    issues: [],
  }));

  if (!apiKey) {
    return { configured: false, openUrl, projects: baseProjects };
  }

  // Linear accepts the raw API key in Authorization (optional "Bearer " prefix)
  const authHeader = apiKey;

  const projects = await Promise.all(
    PROJECT_DEFS.map(async (def) => {
      const linearId = process.env[def.envKey]?.trim();
      if (!linearId) {
        return { id: def.id, name: def.name, issues: [] };
      }
      try {
        const issues = await fetchProjectIssues(authHeader, linearId);
        return { id: def.id, name: def.name, issues };
      } catch (err) {
        console.error(`Linear project ${def.id}:`, err.message);
        return { id: def.id, name: def.name, issues: [] };
      }
    }),
  );

  const configured = PROJECT_DEFS.some((def) => process.env[def.envKey]?.trim());
  return { configured, openUrl, projects };
}
