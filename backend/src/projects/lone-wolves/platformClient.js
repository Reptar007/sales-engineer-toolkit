/**
 * Lone Wolves -- what the scan reads from QA Wolf's public API for one
 * workspace: its environments, the flows and recent runs of the one it
 * counts, its triggers and its bug reports.
 *
 * Every call goes through the Bone Pile's `qawQuery`, so it shares that
 * client's auth (QAW_BEARER_TOKEN / QAWOLF_API_KEY), timeouts and error codes.
 * Read-only: nothing here changes anything in QA Wolf.
 */
import { qawQuery } from '../maintenance-dashboard/qawolfClient.js';
import { DAY_MS, chooseEnvironment } from './onboardingShape.js';

const PAGE_LIMIT = 100;
/** Pages read per list before giving up; a busy workspace still fits. */
const MAX_PAGES = 10;

/** Every page of a list; `onPage` sees each raw answer (for fields beside the list). */
async function readPages(procedure, input, key, options, onPage) {
  const items = [];
  let cursor;
  for (let page = 0; page < (options?.maxPages ?? MAX_PAGES); page += 1) {
    const data = await qawQuery(
      procedure,
      { ...input, limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
      options,
    );
    onPage?.(data);
    items.push(...(Array.isArray(data?.[key]) ? data[key] : []));
    cursor = data?.nextCursor;
    if (!cursor) break;
  }
  return items;
}

/**
 * The workspace's environments, terminated ones left out, and which one is
 * its default (`defaultEnvironmentId`, beside the list in every page).
 */
export async function listEnvironments(workspaceId, options = {}) {
  let defaultEnvironmentId = null;
  const environments = await readPages(
    'public.environment.find',
    { workspaceId },
    'environments',
    options,
    (data) => {
      defaultEnvironmentId = defaultEnvironmentId || data?.defaultEnvironmentId || null;
    },
  );
  return { environments, defaultEnvironmentId };
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
 * Every run of one environment created in [from, to), for weekly usage.
 * The list comes newest first from `createdAfter`, so runs after `to` are
 * read and dropped; a week of a busy workspace is several pages.
 */
export async function listRunsBetween(workspaceId, environmentId, from, to, options = {}) {
  const runs = await readPages(
    'public.run.find',
    { workspaceId, environmentId, createdAfter: new Date(from).toISOString() },
    'runs',
    { ...options, maxPages: 40 },
  );
  return runs.filter((run) => {
    const at = Date.parse(run?.createdAt);
    return Number.isFinite(at) && at >= from && at < to;
  });
}

/** One run with every flow and each flow's attempts (start and end times). */
export function getRun(runId, options = {}) {
  return qawQuery('public.run.get', { runId }, options);
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
 * Everything the row needs for one workspace. Flows and runs are read from
 * one environment only, `options.environmentId` when it is still one of the
 * workspace's, else its default (see chooseEnvironment); every environment
 * is returned so the page can offer the others.
 */
export async function readWorkspace(workspaceId, options = {}) {
  const { environments, defaultEnvironmentId } = await listEnvironments(workspaceId, options);
  const chosen = chooseEnvironment(environments, defaultEnvironmentId, options.environmentId);
  const [triggers, bugs, flows, runs] = await Promise.all([
    listTriggers(workspaceId, options),
    listBugs(workspaceId, options),
    chosen ? listFlows(workspaceId, chosen.id, options) : [],
    chosen ? listRecentRuns(workspaceId, chosen.id, options) : [],
  ]);
  return {
    environments,
    defaultEnvironmentId,
    environmentId: chosen?.id || null,
    flowsByEnvironment: chosen ? { [chosen.id]: flows } : {},
    runs,
    triggers,
    bugs,
  };
}
