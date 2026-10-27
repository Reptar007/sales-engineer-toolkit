/**
 * Lone Wolves -- counting a workspace environment's weekly usage, and
 * pricing it both ways (new runs-based and old per-minute).
 *
 * The rule is Becca's ("Self-serve weekly report: how it's built", Usage) and
 * the Runs-Based Pricing page's:
 *
 * - Weeks run Monday 00:00 to Sunday 24:00 UTC; a run belongs to the week it
 *   was created in.
 * - Flow runs: one per flow per run.
 * - Runner minutes: every attempt's runtime, retries and manual re-attempts
 *   included, from the attempt's own start and end. Never the run's end time,
 *   which is set when its first attempts finish and can come hours before
 *   its last retry.
 * - Run credits: per flow run, 1 for each started 5 minutes of its longest
 *   attempt, at least 1; 2 per block on iOS, Android, Windows and Mac (Linux
 *   Electron is priced as web). Retries add nothing.
 *
 * What run records cannot show, and so is not counted: AI credits, the
 * credit a test's creation uses, and time Tester spends on live runners.
 *
 * Pure, so the rule the page shows is the rule the tests pin.
 */
import { DAY_MS } from './onboardingShape.js';

export const WEEK_MS = 7 * DAY_MS;
const CREDIT_BLOCK_MS = 5 * 60 * 1000;

/**
 * The price a workspace's CSM picked for the page and the usage message:
 * old (per-minute), new (runs-based) or none (counts only, for trials).
 */
export const PRICINGS = ['old', 'new', 'none'];
/** Unpicked reads as old: every customer signed before 10/19 is on it. */
export const DEFAULT_PRICING = 'old';

/** New pricing: $1 per run credit (list; contracts may discount). */
export const NEW_CREDIT_RATE = 1;
/** Old pricing: $0.15 per runner minute, plus AI credits not counted here. */
export const OLD_MINUTE_RATE = 0.15;

const toMs = (value) => {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** Monday 00:00 UTC of the week holding `at`. */
export function weekStartOf(at) {
  const d = new Date(toMs(at));
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return midnight - sinceMonday * DAY_MS;
}

/**
 * Credits per 5-minute block for a flow's execution target ("Web - Chrome",
 * "iOS - …", "Android - …", "Windows", "macOS"). Unknown targets count as web.
 */
export function creditMultiplier(executionTarget) {
  return /\b(ios|iphone|ipad|android|windows|mac|macos)\b/i.test(String(executionTarget || ''))
    ? 2
    : 1;
}

/** One attempt's runtime in ms, or null when it has not finished. */
export function attemptMs(attempt) {
  const start = toMs(attempt?.startedAt);
  const end = toMs(attempt?.completedAt);
  if (start == null || end == null || end < start) return null;
  return end - start;
}

/** A flow run's credits: started 5-minute blocks of its longest attempt, at least 1. */
export function flowRunCredits(attempts = [], multiplier = 1) {
  const longest = Math.max(0, ...attempts.map((a) => attemptMs(a) ?? 0));
  return Math.max(1, Math.ceil(longest / CREDIT_BLOCK_MS)) * multiplier;
}

/**
 * A run's usage from its `run.get` answer: flow runs, attempts, runner
 * seconds and credits. `targets` maps flowId to execution target. Attempts
 * still running carry no time yet; `unfinished` says how many, so a count
 * that will still grow is never passed off as final.
 */
export function runUsage(run, targets = {}) {
  const usage = { flowRuns: 0, attempts: 0, runnerSeconds: 0, credits: 0, unfinished: 0 };
  for (const flow of Array.isArray(run?.flows) ? run.flows : []) {
    const attempts = Array.isArray(flow.attempts) ? flow.attempts : [];
    usage.flowRuns += 1;
    usage.attempts += attempts.length;
    for (const attempt of attempts) {
      const ms = attemptMs(attempt);
      if (ms == null) usage.unfinished += 1;
      else usage.runnerSeconds += ms / 1000;
    }
    usage.credits += flowRunCredits(attempts, creditMultiplier(targets[flow.flowId]));
  }
  return usage;
}

/** Add run usages into a week's totals. */
export function sumUsage(usages) {
  const total = { runs: 0, flowRuns: 0, attempts: 0, runnerSeconds: 0, credits: 0, unfinished: 0 };
  for (const u of usages) {
    total.runs += 1;
    total.flowRuns += u.flowRuns;
    total.attempts += u.attempts;
    total.runnerSeconds += u.runnerSeconds;
    total.credits += u.credits;
    total.unfinished += u.unfinished || 0;
  }
  return total;
}

export const runnerMinutes = (usage) => Math.round((usage.runnerSeconds / 60) * 10) / 10;

/**
 * The week priced both ways, so the CSM picks per customer without the page
 * tracking who is on which (Becca, 10/27): the new runs-based price ($1 a
 * credit, live for new business since 10/19) and the old per-minute price
 * ($0.15 a runner minute plus AI credits), which every customer signed before
 * 10/19 is still on. The old price is runner time only: the public API does
 * not report AI credits, so it says so.
 */
export function priceUsage(usage) {
  if (!usage) return null;
  return {
    new: {
      rate: NEW_CREDIT_RATE,
      amount: Math.round(usage.credits * NEW_CREDIT_RATE * 100) / 100,
    },
    old: {
      rate: OLD_MINUTE_RATE,
      amount: Math.round((usage.runnerSeconds / 60) * OLD_MINUTE_RATE * 100) / 100,
      excludesAiCredits: true,
    },
  };
}

/** A week's totals as the page sends them. */
export function shapeWeek(weekStart, usage) {
  if (!usage) return null;
  return {
    weekStart: new Date(weekStart).toISOString(),
    runs: usage.runs,
    flowRuns: usage.flowRuns,
    attempts: usage.attempts,
    runnerMinutes: runnerMinutes(usage),
    credits: usage.credits,
    unfinished: usage.unfinished || 0,
    prices: priceUsage(usage),
  };
}
