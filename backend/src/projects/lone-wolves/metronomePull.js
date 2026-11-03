/**
 * Lone Wolves -- "Pull from Metronome": billing's AI credits and interactive
 * minutes for a workspace environment, read live instead of from a CSV.
 *
 * What the Metronome usage script does, on the server:
 *
 * 1. The environment's Tester chat sessions, from Task Wolf (the platform
 *    database), instead of a session file refreshed by hand.
 * 2. Every usage event for the customer's Metronome ids since the week of
 *    kickoff, with the token an editor pasted (metronomeClient.js).
 * 3. Summed per week for the environment (weeksFromEvents) and kept in the
 *    same table as an imported CSV, so the page reads them the same way.
 *
 * A pull takes a minute or two (thousands of events, a thousand a page),
 * longer than Heroku lets a request run, so it runs in the background and
 * the page asks for its status. One pull per workspace at a time. The token
 * lives only in the running pull's closure and is dropped when it ends.
 */
import { pullEvents } from './metronomeClient.js';
import { weeksFromEvents } from './meteredImport.js';
import { chatSessionIds } from './taskWolfSource.js';
import { WEEK_MS, weekStartOf } from './usageShape.js';
import { OnboardingError, saveMeteredWeeks } from './workspaceStore.js';
import { defaultTaskWolfClient } from '../maintenance-dashboard/maintenanceService.js';

/** Weeks pulled when no kickoff date is recorded; and the most pulled with one. */
const DEFAULT_WEEKS = 6;
const MAX_WEEKS = 16;

const jobs = new Map();

/** Test hook: forget every pull. */
export function resetPulls() {
  jobs.clear();
}

/**
 * The weeks a pull covers, oldest first: from the week of kickoff (at most
 * sixteen weeks back) to this week; without a kickoff date, the last six.
 */
export function pullWeeks(kickoffOn, now = Date.now()) {
  const thisWeek = weekStartOf(now);
  const kickoff = kickoffOn ? Date.parse(kickoffOn) : NaN;
  let first = thisWeek - (DEFAULT_WEEKS - 1) * WEEK_MS;
  if (Number.isFinite(kickoff) && kickoff <= now) {
    first = Math.max(weekStartOf(kickoff), thisWeek - (MAX_WEEKS - 1) * WEEK_MS);
  }
  const weeks = [];
  for (let at = first; at <= thisWeek; at += WEEK_MS) weeks.push(at);
  return weeks;
}

/** Every week in the pull, zero where Metronome had nothing for the environment. */
export function fillWeeks(weekStarts, found) {
  const byWeek = new Map(found.map((w) => [w.weekStart, w]));
  return weekStarts.map(
    (at) =>
      byWeek.get(at) || { weekStart: at, aiCredits: 0, interactiveMinutes: 0, suiteMinutes: 0 },
  );
}

/** A pull's steps, in order, as the page shows them ("Step 2 of 3"). */
export const PULL_STEPS = [
  'Finding the sessions where the customer built tests',
  'Reading usage from Metronome',
  'Saving the weeks',
];

/** Why a pull failed, for the page to explain: the token, Metronome, or Task Wolf. */
export const SESSIONS_FAILED = 'PULL_SESSIONS';

const toStep = (job, number) => {
  job.stepNumber = number;
  job.step = PULL_STEPS[number - 1];
};

const publicStatus = (job) =>
  job
    ? {
        state: job.state,
        startedAt: new Date(job.startedAt).toISOString(),
        finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
        step: job.step,
        stepNumber: job.stepNumber,
        stepCount: PULL_STEPS.length,
        events: job.events,
        weeks: job.weeks,
        error: job.error,
        errorCode: job.errorCode,
        by: job.by,
      }
    : { state: 'idle' };

/** Where a workspace's pull stands: idle, running (with its step), done or failed. */
export function pullStatus(workspaceId) {
  return publicStatus(jobs.get(workspaceId));
}

/**
 * Start a pull. Refused while one runs for the workspace, without Metronome
 * ids or a token. Resolves to the status at once; `done` is the promise of
 * the pull itself, for the tests.
 */
export function startPull({
  workspaceId,
  environmentId,
  aliases,
  kickoffOn = null,
  token,
  viewer,
  now = Date.now(),
  taskWolfClient = defaultTaskWolfClient(),
  pullEventsImpl = pullEvents,
  sessionIdsImpl = chatSessionIds,
  saveImpl = saveMeteredWeeks,
}) {
  if (jobs.get(workspaceId)?.state === 'running') {
    throw new OnboardingError('ONBOARDING_BUSY', 'A pull is already running for this workspace.');
  }
  if (!aliases) {
    throw new OnboardingError(
      'ONBOARDING_INVALID',
      'Add the customer’s Metronome ids in Edit details first.',
    );
  }
  if (!token) throw new OnboardingError('ONBOARDING_INVALID', 'Paste a Metronome token first.');
  if (!environmentId) {
    throw new OnboardingError('ONBOARDING_INVALID', 'The workspace has no environment to count.');
  }
  if (!taskWolfClient) {
    throw new OnboardingError(
      'ONBOARDING_INVALID',
      'Task Wolf is not configured, so the environment’s chat sessions cannot be read.',
    );
  }
  const weekStarts = pullWeeks(kickoffOn, now);
  const job = {
    state: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    step: null,
    stepNumber: null,
    events: 0,
    weeks: null,
    error: null,
    errorCode: null,
    by: viewer?.email || null,
  };
  toStep(job, 1);
  jobs.set(workspaceId, job);
  const done = (async () => {
    try {
      const sessions = await sessionIdsImpl(taskWolfClient, environmentId).catch((error) => {
        throw new OnboardingError(
          SESSIONS_FAILED,
          `Task Wolf could not list the environment’s chat sessions (${error?.message || 'no answer'}).`,
        );
      });
      toStep(job, 2);
      const events = await pullEventsImpl({
        token,
        aliases: aliases.split(','),
        start: new Date(weekStarts[0]).toISOString(),
        end: new Date(now).toISOString(),
        onProgress: (count) => {
          job.events = count;
        },
      });
      toStep(job, 3);
      const weeks = fillWeeks(weekStarts, weeksFromEvents(events, environmentId, sessions));
      await saveImpl(workspaceId, environmentId, weeks, viewer);
      job.weeks = weeks.map((w) => ({ ...w, weekStart: new Date(w.weekStart).toISOString() }));
      job.state = 'done';
    } catch (error) {
      if (!(error instanceof OnboardingError))
        console.error('Metronome pull failed:', error.message);
      job.state = 'failed';
      job.error = error?.message || 'The pull failed.';
      job.errorCode = error?.code || null;
    } finally {
      job.finishedAt = Date.now();
      job.step = null;
      job.stepNumber = null;
    }
  })();
  return { status: publicStatus(job), done };
}
