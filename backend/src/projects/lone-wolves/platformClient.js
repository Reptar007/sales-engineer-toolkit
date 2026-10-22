/**
 * Lone Wolves -- what the scan reads from QA Wolf's public API for one
 * workspace: its environments, the flows in each static one, its triggers,
 * its recent runs and its bug reports.
 *
 * Every call goes through the Bone Pile's `qawQuery`, so it shares that
 * client's auth (QAW_BEARER_TOKEN / QAWOLF_API_KEY), timeouts and error codes.
 * Read-only: nothing here changes anything in QA Wolf.
 */
import { qawQuery } from '../maintenance-dashboard/qawolfClient.js';
import { DAY_MS } from './onboardingShape.js';

const PAGE_LIMIT = 100;
/** Pages read per list before giving up; a busy workspace still fits. */
const MAX_PAGES = 10;

async function readPages(procedure, input, key, options) {
  const items = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await qawQuery(
      procedure,
      { ...input, limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
      options,
    );
    items.push(...(Array.isArray(data?.[key]) ? data[key] : []));
    cursor = data?.nextCursor;
    if (!cursor) break;
  }
  return items;
}

/** The workspace's environments, terminated ones left out. */
export function listEnvironments(workspaceId, options = {}) {
  return readPages('public.environment.find', { workspaceId }, 'environments', options);
}

/** The flows of one environment, drafts included. */
export async function listFlows(workspaceId, environmentId, options = {}) {
  const data = await qawQuery(
    'public.flow.list',
    { workspaceId, environmentId, includeDrafts: true },
    options,
  );
  return Array.isArray(data?.flows) ? data.flows : [];
}

/** The workspace's triggers, paused ones included (the shape drops them). */
export async function listTriggers(workspaceId, options = {}) {
  const data = await qawQuery('public.trigger.find', { workspaceId }, options);
  return Array.isArray(data?.triggers) ? data.triggers : [];
}

/**
 * One environment's runs: every run of the last 24 hours, plus the newest
 * run of all, so a workspace that went quiet a month ago still says when.
 */
export async function listRecentRuns(workspaceId, environmentId, options = {}) {
  const now = options.now ?? Date.now();
  const newest = await qawQuery(
    'public.run.find',
    { workspaceId, environmentId, limit: 1 },
    options,
  );
  const latest = Array.isArray(newest?.runs) ? newest.runs : [];
  const latestAt = Date.parse(latest[0]?.createdAt);
  if (!Number.isFinite(latestAt) || latestAt < now - DAY_MS) return latest;
  return readPages(
    'public.run.find',
    { workspaceId, environmentId, createdAfter: new Date(now - DAY_MS).toISOString() },
    'runs',
    options,
  );
}

/**
 * Open bug reports, plus at most one closed one when none are open, which is
 * all the first-bug step needs to know a bug was ever filed.
 */
export async function listBugs(workspaceId, options = {}) {
  const open = await readPages(
    'public.issue.find',
    { workspaceId, type: 'bug' },
    'issues',
    options,
  );
  if (open.length > 0) return open;
  const closed = await qawQuery(
    'public.issue.find',
    { workspaceId, type: 'bug', statuses: ['resolved', 'canceled', 'archived'], limit: 1 },
    options,
  );
  return Array.isArray(closed?.issues) ? closed.issues : [];
}

/**
 * Everything the row needs for one workspace. Flows and runs are read per
 * static environment; preview environments come and go with pull requests.
 */
export async function readWorkspace(workspaceId, options = {}) {
  const environments = await listEnvironments(workspaceId, options);
  const statics = environments.filter((env) => env?.kind !== 'preview');
  const [triggers, bugs, perEnvironment] = await Promise.all([
    listTriggers(workspaceId, options),
    listBugs(workspaceId, options),
    Promise.all(
      statics.map(async (env) => ({
        id: env.id,
        flows: await listFlows(workspaceId, env.id, options),
        runs: await listRecentRuns(workspaceId, env.id, options),
      })),
    ),
  ]);
  return {
    environments,
    flowsByEnvironment: Object.fromEntries(perEnvironment.map((env) => [env.id, env.flows])),
    runs: perEnvironment.flatMap((env) => env.runs),
    triggers,
    bugs,
  };
}
