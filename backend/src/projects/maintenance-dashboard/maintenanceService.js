/**
 * Builds and caches the maintenance backlog snapshot.
 *
 * One snapshot is ~1,300 `issue.find` calls (one per workspace the key can
 * see), which is minutes of fan-out, so the page never waits on a live scan:
 * a GET answers the cached snapshot, or a "building" status with progress
 * while the first scan runs in the background. A scan that fails on a few
 * workspaces still produces a snapshot -- the failures ride along in
 * `errors`, so the page can say "1,290 of 1,301 scanned" instead of showing
 * a number that is quietly short.
 *
 * The cache is per-process. Heroku restarts the dyno daily, so the first
 * request after a restart rebuilds it; that is acceptable for a page read a
 * few times a day, and it keeps this change free of schema migrations.
 */
import { listWorkspaces, listOpenMaintenanceReports } from './qawolfClient.js';
import { buildSnapshot, parseExcludedSlugs } from './maintenanceShape.js';

const DEFAULT_TTL_MINUTES = 6 * 60;
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 16;

const state = {
  snapshot: null, // last completed snapshot
  builtAt: 0, // Date.now() when it completed
  building: null, // in-flight promise, if any
  progress: null, // { scanned, total, startedAt, failed }
  lastError: null, // last whole-scan failure (auth, config, whoami)
};

function readNumberEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getCacheTtlMs() {
  return readNumberEnv('MAINTENANCE_DASHBOARD_CACHE_TTL_MINUTES', DEFAULT_TTL_MINUTES) * 60 * 1000;
}

export function getScanConcurrency() {
  return Math.min(
    MAX_CONCURRENCY,
    readNumberEnv('MAINTENANCE_DASHBOARD_CONCURRENCY', DEFAULT_CONCURRENCY),
  );
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Returns results in
 * input order; a worker's throw is captured as `{ error }` rather than
 * aborting the whole batch, so one broken workspace cannot hide the rest.
 * `onSettled` may throw to abort: the remaining items are skipped and the
 * throw is rethrown once the in-flight workers settle.
 */
export async function mapWithConcurrency(items, limit, worker, onSettled) {
  const results = new Array(items.length);
  let next = 0;
  let abort = null;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !abort) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { error };
      }
      if (onSettled && !abort) {
        try {
          onSettled(results[index], index);
        } catch (error) {
          abort = error;
        }
      }
    }
  });
  await Promise.all(lanes);
  if (abort) throw abort;
  return results;
}

/**
 * Scan every workspace and build a fresh snapshot. Exported for the refresh
 * route and for tests, which inject their own client functions.
 */
export async function scanMaintenanceBacklog({
  client = { listWorkspaces, listOpenMaintenanceReports },
  concurrency = getScanConcurrency(),
  excludedSlugs = parseExcludedSlugs(process.env.MAINTENANCE_DASHBOARD_EXCLUDED_SLUGS),
  onProgress,
  now = Date.now,
} = {}) {
  const workspaces = await client.listWorkspaces();
  const total = workspaces.length;
  const progress = { scanned: 0, total, failed: 0, startedAt: new Date(now()).toISOString() };
  if (onProgress) onProgress({ ...progress });

  const reportsByWorkspace = new Map();
  const errors = [];

  await mapWithConcurrency(
    workspaces,
    concurrency,
    (workspace) => client.listOpenMaintenanceReports(workspace.id),
    (result, index) => {
      const workspace = workspaces[index];
      if (result.error) {
        // An auth failure is not "this workspace has no backlog"; it is the
        // whole scan being blind. Surface it loudly instead of tallying it.
        if (result.error.code === 'QAW_AUTH') throw result.error;
        progress.failed += 1;
        errors.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          message: result.error.message || String(result.error),
        });
      } else {
        reportsByWorkspace.set(workspace.id, result.value || []);
      }
      progress.scanned += 1;
      if (onProgress) onProgress({ ...progress });
    },
  );

  return buildSnapshot({ workspaces, reportsByWorkspace, excludedSlugs, errors, now: now() });
}

/** Kick a background rebuild unless one is already running. */
export function startRefresh(options = {}) {
  if (state.building) return state.building;
  state.lastError = null;
  state.progress = { scanned: 0, total: 0, failed: 0, startedAt: new Date().toISOString() };

  state.building = scanMaintenanceBacklog({
    ...options,
    onProgress: (progress) => {
      state.progress = progress;
    },
  })
    .then((snapshot) => {
      state.snapshot = snapshot;
      state.builtAt = Date.now();
      return snapshot;
    })
    .catch((error) => {
      console.error('Maintenance backlog scan failed:', error);
      state.lastError = { code: error.code || 'SCAN_FAILED', message: error.message };
      throw error;
    })
    .finally(() => {
      state.building = null;
      state.progress = null;
    });

  // Nobody has to await a background build; keep the rejection from surfacing
  // as an unhandled promise when the trigger was a fire-and-forget GET.
  state.building.catch(() => {});
  return state.building;
}

/**
 * What the page asks for. Answers straight from cache when it is fresh enough,
 * starts a rebuild otherwise, and never blocks on the scan itself.
 *
 * @param {{ refresh?: boolean }} [options]
 * @returns {{ status: 'ready'|'building'|'error', snapshot?: object, stale?: boolean, progress?: object, error?: object }}
 */
export function getMaintenanceDashboard({ refresh = false } = {}) {
  const now = Date.now();
  const isStale = !state.snapshot || now - state.builtAt > getCacheTtlMs();

  if (refresh || isStale) startRefresh();

  if (state.snapshot) {
    return {
      status: 'ready',
      snapshot: state.snapshot,
      builtAt: new Date(state.builtAt).toISOString(),
      stale: isStale,
      refreshing: Boolean(state.building),
      progress: state.progress,
      cacheTtlMinutes: Math.round(getCacheTtlMs() / 60000),
    };
  }

  if (state.building) {
    return { status: 'building', progress: state.progress };
  }

  return { status: 'error', error: state.lastError || { message: 'No snapshot available.' } };
}

/** Test hook: forget everything. */
export function resetMaintenanceCache() {
  state.snapshot = null;
  state.builtAt = 0;
  state.building = null;
  state.progress = null;
  state.lastError = null;
}
