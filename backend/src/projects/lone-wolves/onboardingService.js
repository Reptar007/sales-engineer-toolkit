/**
 * Lone Wolves -- builds and caches the onboarding scan, and joins it to the
 * page's own records on every read.
 *
 * The scan is the slow part (Task Wolf for the workspace list and customer
 * runs, then a handful of QA Wolf calls per environment), so like the Bone
 * Pile the page never waits on it: a read answers the cached scan, starting a
 * rebuild in the background when it is older than the cache window, and the
 * very first read answers "building".
 *
 * What the scan caches is what the platforms said, not the rows. Rows are
 * built per request from that and from the OnboardingWorkspace table, so a
 * kickoff date or failure owner saved on the page shows at once, and day
 * counts move with the clock, without a rescan.
 *
 * The cache is per-process, like the Bone Pile's; a dyno restart rebuilds it.
 */
import {
  mapWithConcurrency,
  defaultTaskWolfClient,
} from '../maintenance-dashboard/maintenanceService.js';
import { buildRow, sortRows, summarize } from './onboardingShape.js';
import { readWorkspace } from './platformClient.js';
import { customerPeople, customerRunFor, listTeamWorkspaces } from './taskWolfSource.js';
import { listDetails } from './workspaceStore.js';
import { weeklyUsage } from './usageService.js';
import { shapeWeek } from './usageShape.js';

/** A row's usage cell: this week so far and last week, each priced both ways, or why not. */
export function shapeRowUsage(usage) {
  if (!usage) return null;
  if (usage.error) return { error: usage.error };
  return {
    thisWeek: shapeWeek(usage.thisWeekStart, usage.thisWeek),
    lastWeek: shapeWeek(usage.lastWeekStart, usage.lastWeek),
  };
}

const minutes = (name, fallback) => {
  const value = Number(process.env[name]);
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 60 * 1000;
};

export const getCacheTtlMs = () => minutes('ONBOARDING_CACHE_TTL_MINUTES', 30);
export const getMinRescanMs = () => minutes('ONBOARDING_MIN_RESCAN_MINUTES', 2);
const SCAN_CONCURRENCY = 4;

const state = {
  scan: null,
  builtAt: null,
  building: null,
  again: false,
  lastError: null,
  failedAt: null,
};

/**
 * The workspaces to scan: the onboarding QA team's, plus any added by hand,
 * minus any hidden. Hidden wins, so taking a team workspace off the page
 * sticks across rescans.
 */
export function workspacesToScan(teamWorkspaces, details) {
  const hidden = new Set(details.filter((d) => d.hidden).map((d) => d.workspaceId));
  const out = new Map();
  for (const ws of teamWorkspaces) {
    if (!hidden.has(ws.id)) out.set(ws.id, { ...ws, source: 'team' });
  }
  for (const d of details) {
    if (!d.addedManually || d.hidden || out.has(d.workspaceId)) continue;
    out.set(d.workspaceId, {
      id: d.workspaceId,
      name: d.workspaceName || d.workspaceId,
      slug: null,
      source: 'manual',
    });
  }
  return [...out.values()];
}

/**
 * One full scan. Dependencies are injectable so the tests need no network:
 * `taskWolfClient` (null when no token is set: the team list and customer
 * runs are then skipped and the page says so), `readWorkspaceImpl`,
 * `weeklyUsageImpl` and `listDetailsImpl`.
 */
export async function scanOnboarding({
  taskWolfClient = defaultTaskWolfClient(),
  readWorkspaceImpl = readWorkspace,
  weeklyUsageImpl = weeklyUsage,
  listDetailsImpl = listDetails,
  now = Date.now(),
} = {}) {
  const warnings = [];
  const details = await listDetailsImpl();
  let team = [];
  if (taskWolfClient) {
    try {
      team = await listTeamWorkspaces(taskWolfClient);
    } catch (error) {
      warnings.push(`Task Wolf could not list the SelfService team: ${error.message}`);
    }
  } else {
    warnings.push('Task Wolf is not configured, so only workspaces added by hand are listed.');
  }
  const workspaces = workspacesToScan(team, details);
  let people = new Map();
  if (taskWolfClient && workspaces.length > 0) {
    try {
      people = await customerPeople(
        taskWolfClient,
        workspaces.map((ws) => ws.id),
      );
    } catch (error) {
      warnings.push(`Task Wolf could not list customer people: ${error.message}`);
    }
  }
  const environmentFor = new Map(details.map((d) => [d.workspaceId, d.environmentId || null]));
  // Weekly usage of the environment the row counts. A failure here leaves the
  // usage cell saying so and the rest of the row standing.
  const usageFor = async (workspaceId, platform) => {
    if (!platform || platform.error || !platform.environmentId) return null;
    const flows = platform.flowsByEnvironment?.[platform.environmentId] || [];
    try {
      return await weeklyUsageImpl({
        workspaceId,
        environmentId: platform.environmentId,
        targets: Object.fromEntries(flows.map((flow) => [flow.flowId, flow.executionTarget])),
        now,
      });
    } catch (error) {
      if (error?.code === 'QAW_AUTH' || error?.code === 'QAW_CONFIG') throw error;
      return { error: error?.message || 'Usage could not be read.' };
    }
  };
  const results = await mapWithConcurrency(workspaces, SCAN_CONCURRENCY, async (ws) => {
    const [platform, customerRun] = await Promise.all([
      readWorkspaceImpl(ws.id, { now, environmentId: environmentFor.get(ws.id) }).catch((error) => {
        // An expired key fails every workspace the same way; say it once, loudly.
        if (error?.code === 'QAW_AUTH' || error?.code === 'QAW_CONFIG') throw error;
        return { error: error?.message || 'QA Wolf could not be read.' };
      }),
      taskWolfClient ? customerRunFor(taskWolfClient, ws.id, people.get(ws.id)) : null,
    ]);
    return { workspace: ws, platform, customerRun, usage: await usageFor(ws.id, platform) };
  });
  const fatal = results.find((result) => result.error);
  if (fatal) throw fatal.error;
  return {
    generatedAt: new Date(now).toISOString(),
    workspaces: results.map((result) => result.value),
    taskWolf: Boolean(taskWolfClient),
    warnings,
  };
}

/**
 * Start a scan unless one is running; resolves when it settles. Asked while
 * one runs (a workspace was just added, say), it queues one more after it,
 * since the running scan was planned before the change.
 */
export function startRefresh(options = {}) {
  if (state.building) {
    state.again = true;
    return state.building;
  }
  state.building = scanOnboarding(options)
    .then((scan) => {
      state.scan = scan;
      state.builtAt = Date.now();
      state.lastError = null;
      state.failedAt = null;
    })
    .catch((error) => {
      console.error('Lone Wolves scan failed:', error);
      state.lastError = error;
      state.failedAt = Date.now();
    })
    .finally(() => {
      state.building = null;
      if (state.again) {
        state.again = false;
        startRefresh(options);
      }
    });
  return state.building;
}

/**
 * Ask for a rescan. Refused (with how long to wait) while one runs or when
 * the last one finished less than the minimum gap ago.
 */
export function requestRescan(now = Date.now()) {
  if (state.building) return { accepted: false, retryAfterMs: 5000 };
  const last = Math.max(state.builtAt || 0, state.failedAt || 0);
  const wait = last + getMinRescanMs() - now;
  if (wait > 0) return { accepted: false, retryAfterMs: wait };
  startRefresh();
  return { accepted: true, retryAfterMs: 0 };
}

/** The scan joined to the page's records, in page order. */
export function rowsFor(scan, details, now = Date.now()) {
  const byId = new Map(details.map((d) => [d.workspaceId, d]));
  const visible = scan.workspaces.filter((entry) => !byId.get(entry.workspace.id)?.hidden);
  return sortRows(
    visible.map(({ workspace, platform, customerRun, usage }) => {
      const details = byId.get(workspace.id) || {};
      return {
        ...buildRow({
          workspace: { ...workspace, name: details.workspaceName || workspace.name },
          details,
          platform,
          customerRun,
          now,
        }),
        usage: shapeRowUsage(usage),
      };
    }),
  );
}

/**
 * What GET answers. `status` is 'ready' with rows once a scan exists (a stale
 * one still answers while a rebuild runs), 'building' during the first scan,
 * or 'error' when there is no scan and the last attempt failed.
 */
export async function getOnboardingDashboard({
  refresh = false,
  now = Date.now(),
  listDetailsImpl = listDetails,
} = {}) {
  const stale = !state.builtAt || now - state.builtAt > getCacheTtlMs();
  if (refresh) requestRescan(now);
  else if (
    stale &&
    !state.building &&
    !(state.failedAt && now - state.failedAt < getMinRescanMs())
  ) {
    startRefresh();
  }
  if (!state.scan) {
    if (state.lastError && !state.building) {
      return {
        status: 'error',
        error: state.lastError,
        failedAt: new Date(state.failedAt).toISOString(),
      };
    }
    return { status: 'building' };
  }
  const rows = rowsFor(state.scan, await listDetailsImpl(), now);
  return {
    status: 'ready',
    builtAt: new Date(state.builtAt).toISOString(),
    refreshing: Boolean(state.building),
    refreshError: state.lastError ? state.lastError.message : null,
    taskWolf: state.scan.taskWolf,
    warnings: state.scan.warnings,
    summary: summarize(rows),
    rows,
  };
}

/** Test hook: forget the cache. */
export function resetOnboardingCache() {
  state.scan = null;
  state.builtAt = null;
  state.building = null;
  state.again = false;
  state.lastError = null;
  state.failedAt = null;
}
