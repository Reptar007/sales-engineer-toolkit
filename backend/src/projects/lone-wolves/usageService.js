/**
 * Lone Wolves -- reading a workspace environment's weekly usage from QA Wolf.
 *
 * Usage needs every run's attempts, which is one `run.get` per run: about 22
 * a week for Panorama, hundreds for SharkNinja. Two caches keep a scan from
 * re-reading them:
 *
 * - A finished week (Monday to Sunday UTC) is counted once and kept in the
 *   database (OnboardingUsageWeek). It is only kept once every attempt in it
 *   has finished, so a retry still running on Monday morning is not lost.
 * - Within the current week, a run's usage is remembered in this process
 *   once the run is old enough that no more retries will land on it
 *   (SETTLED_AFTER_MS), so each scan reads only the newest runs.
 */
import { mapWithConcurrency } from '../maintenance-dashboard/maintenanceService.js';
import { getRun, listRunsBetween } from './platformClient.js';
import { WEEK_MS, runUsage, sumUsage, weekStartOf } from './usageShape.js';
import { getUsageWeek, saveUsageWeek } from './workspaceStore.js';

/** A run this old has had its retries and manual re-attempts; its usage is final. */
const SETTLED_AFTER_MS = 12 * 60 * 60 * 1000;
const RUN_CONCURRENCY = 6;

const settledRuns = new Map();

/** Test hook: forget remembered runs. */
export function resetUsageCache() {
  settledRuns.clear();
}

/**
 * One week's usage for one environment. `targets` maps flowId to execution
 * target (from the environment's flow list) for the mobile and desktop
 * credit rate.
 */
export async function countWeek({
  workspaceId,
  environmentId,
  weekStart,
  targets,
  now = Date.now(),
  listRunsImpl = listRunsBetween,
  getRunImpl = getRun,
}) {
  const runs = await listRunsImpl(workspaceId, environmentId, weekStart, weekStart + WEEK_MS, {
    now,
  });
  const results = await mapWithConcurrency(runs, RUN_CONCURRENCY, async (run) => {
    const cached = settledRuns.get(run.runId);
    if (cached) return cached;
    const usage = runUsage(await getRunImpl(run.runId), targets);
    const settled = now - Date.parse(run.createdAt) > SETTLED_AFTER_MS && usage.unfinished === 0;
    if (settled) settledRuns.set(run.runId, usage);
    return usage;
  });
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  return sumUsage(results.map((result) => result.value));
}

/**
 * This week so far, and last week (stored once counted). Returns the week
 * starts beside the totals so the page can name the dates.
 */
export async function weeklyUsage({
  workspaceId,
  environmentId,
  targets,
  now = Date.now(),
  countWeekImpl = countWeek,
  getStoredImpl = getUsageWeek,
  saveStoredImpl = saveUsageWeek,
}) {
  const thisWeekStart = weekStartOf(now);
  const lastWeekStart = thisWeekStart - WEEK_MS;
  const base = { workspaceId, environmentId, targets, now };

  let lastWeek = await getStoredImpl(workspaceId, environmentId, lastWeekStart);
  if (!lastWeek) {
    lastWeek = await countWeekImpl({ ...base, weekStart: lastWeekStart });
    if (lastWeek.unfinished === 0) {
      await saveStoredImpl(workspaceId, environmentId, lastWeekStart, lastWeek);
    }
  }
  const thisWeek = await countWeekImpl({ ...base, weekStart: thisWeekStart });
  return { thisWeekStart, thisWeek, lastWeekStart, lastWeek };
}
