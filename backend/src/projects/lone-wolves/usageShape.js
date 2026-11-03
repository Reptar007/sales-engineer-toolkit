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
 * What run records cannot show: AI credits, the credit a test's creation
 * uses, and time Tester spends on live (interactive) runners. AI credits and
 * interactive minutes come in by hand instead, from billing's Metronome
 * export (meteredImport.js), and the old price adds them when a week has them.
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
/** Old pricing: $0.15 per runner minute (suite and interactive) ... */
export const OLD_MINUTE_RATE = 0.15;
/** ... plus $0.01 per AI credit. */
export const OLD_AI_CREDIT_RATE = 0.01;

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

/** Weeks shown without a kickoff date; and the most shown with one (a pilot and
 * its follow-up, e.g. 12 Oct to 23 Nov is seven). */
const DEFAULT_WEEKS = 4;
const MAX_WEEKS = 10;

/**
 * The weeks a workspace's usage covers, newest first: from the week of its
 * kickoff to this week (a pilot is about a month, so this is its usage to
 * date), at most ten weeks and always at least this week and last; without
 * a kickoff date, the last four. `sinceKickoff` says which, for the total.
 */
export function usageWindow(kickoffOn, now = Date.now()) {
  const thisWeek = weekStartOf(now);
  const kickoff = kickoffOn == null ? null : toMs(kickoffOn);
  let first = thisWeek - (DEFAULT_WEEKS - 1) * WEEK_MS;
  let sinceKickoff = false;
  if (kickoff != null && kickoff <= now) {
    first = weekStartOf(kickoff);
    sinceKickoff = first >= thisWeek - (MAX_WEEKS - 1) * WEEK_MS;
    first = Math.min(first, thisWeek - WEEK_MS);
    first = Math.max(first, thisWeek - (MAX_WEEKS - 1) * WEEK_MS);
  }
  const weekStarts = [];
  for (let at = thisWeek; at >= first; at -= WEEK_MS) weekStarts.push(at);
  return { weekStarts, sinceKickoff };
}

/** Add weeks' totals into one (the window's total). */
export function addWeeks(weeks) {
  const total = { runs: 0, flowRuns: 0, attempts: 0, runnerSeconds: 0, credits: 0, unfinished: 0 };
  for (const w of weeks) {
    if (!w) continue;
    total.runs += w.runs;
    total.flowRuns += w.flowRuns;
    total.attempts += w.attempts;
    total.runnerSeconds += w.runnerSeconds;
    total.credits += w.credits;
    total.unfinished += w.unfinished || 0;
  }
  return total;
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

const cents = (n) => Math.round(n * 100) / 100;

/**
 * The week priced both ways, so the CSM picks per customer without the page
 * tracking who is on which (Becca, 10/27): the new runs-based price ($1 a
 * credit, live for new business since 10/19) and the old per-minute price,
 * which every customer signed before 10/19 is still on.
 *
 * The old price is $0.15 a runner minute plus $0.01 an AI credit (Anna,
 * 11/2). When billing's numbers were imported for the week (`metered`), all
 * three parts come from them: billing leaves QA Wolf staff out and meters
 * runner time its own way, so run records read a little lower (159.7 against
 * 174 suite minutes for Panorama's week of 26 Oct). Without an import the old
 * price is run records' suite time only and says so (`excludesAiCredits`).
 * Interactive (test-building) minutes are billed as runner minutes on the old
 * model (Fahd, 11/2; Mateus to confirm), so `withoutBuilding` is the same
 * price leaving them out until that is settled. The new price is run credits only: the runs-based model
 * does not bill interactive time up to fair use (also to confirm).
 */
export function priceUsage(usage, metered = null) {
  if (!usage) return null;
  const suite = (metered ? metered.suiteMinutes : usage.runnerSeconds / 60) * OLD_MINUTE_RATE;
  const interactive = metered ? metered.interactiveMinutes * OLD_MINUTE_RATE : 0;
  const ai = metered ? metered.aiCredits * OLD_AI_CREDIT_RATE : 0;
  return {
    new: {
      rate: NEW_CREDIT_RATE,
      amount: cents(usage.credits * NEW_CREDIT_RATE),
    },
    old: {
      rate: OLD_MINUTE_RATE,
      aiCreditRate: OLD_AI_CREDIT_RATE,
      amount: cents(suite + interactive + ai),
      withoutBuilding: metered ? cents(suite + ai) : null,
      parts: metered
        ? { suite: cents(suite), interactive: cents(interactive), ai: cents(ai) }
        : null,
      excludesAiCredits: !metered,
    },
  };
}

/** Add imported weeks into one; null when none of them has an import. */
export function addMetered(list) {
  const present = list.filter(Boolean);
  if (!present.length) return null;
  const total = { aiCredits: 0, interactiveMinutes: 0, suiteMinutes: 0 };
  for (const m of present) {
    total.aiCredits += m.aiCredits;
    total.interactiveMinutes += m.interactiveMinutes;
    total.suiteMinutes += m.suiteMinutes;
  }
  return {
    aiCredits: cents(total.aiCredits),
    interactiveMinutes: cents(total.interactiveMinutes),
    suiteMinutes: cents(total.suiteMinutes),
  };
}

const shapeMetered = (m) =>
  m
    ? {
        aiCredits: cents(m.aiCredits),
        interactiveMinutes: cents(m.interactiveMinutes),
        suiteMinutes: cents(m.suiteMinutes),
        importedAt: m.importedAt ? new Date(m.importedAt).toISOString() : null,
      }
    : null;

/**
 * A week's totals as the page sends them; `metered` is the week's imported
 * billing numbers, or null when none were imported for it. `runnerMinutes`
 * is billing's suite minutes when imported, else run records';
 * `recordedMinutes` is always run records', for comparing.
 */
export function shapeWeek(weekStart, usage, metered = null) {
  if (!usage) return null;
  return {
    weekStart: new Date(weekStart).toISOString(),
    runs: usage.runs,
    flowRuns: usage.flowRuns,
    attempts: usage.attempts,
    runnerMinutes: metered ? Math.round(metered.suiteMinutes * 10) / 10 : runnerMinutes(usage),
    recordedMinutes: runnerMinutes(usage),
    credits: usage.credits,
    unfinished: usage.unfinished || 0,
    metered: shapeMetered(metered),
    prices: priceUsage(usage, metered),
  };
}
