/**
 * Lone Wolves -- pure shaping of one workspace's onboarding health.
 *
 * Everything here takes what the scan read (QA Wolf's environments, flows,
 * triggers, runs and bug reports, Task Wolf's recent suites, and the details
 * someone recorded on the page) and turns it into the row the page renders.
 * No I/O, so the rules the page shows are the rules the tests pin.
 *
 * The six activation steps are Kyla's first-30-days list plus "first run the
 * customer started", in the order the page draws them. Each is 'y' (done),
 * 'n' (not yet) or 'u' (unknown): a step the platform cannot see, and nobody
 * has recorded, stays unknown rather than being guessed either way.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export const SEGMENTS = ['self', 'custom', 'pilot', 'hybrid'];

export const STEPS = [
  { key: 'firstFlow', label: 'First flow active', short: 'First flow', day: 1 },
  { key: 'customerRun', label: 'First run started by the customer', short: 'Customer run', day: 3 },
  { key: 'dailyRun', label: 'Daily run producing results', short: 'Daily run', day: 3 },
  { key: 'firstBug', label: 'First real bug reported', short: 'First bug', day: 7 },
  { key: 'failureOwner', label: 'Named owner reviewing failures', short: 'Failure owner', day: 14 },
  { key: 'clientTests', label: 'Client building tests', short: 'Client tests', day: 14 },
];

/** Without a recorded pilot length, a non-hybrid workspace decides at day 30. */
export const DEFAULT_DECISION_DAY = 30;

/** Five or more bug reports filed in a day is a spike worth a look. */
export const BUG_SPIKE_THRESHOLD = 5;

/** No run at all for this long, with flows active, counts as stalled. */
export const STALLED_AFTER_DAYS = 7;

/** A daily schedule counts as producing results with a run this recent. */
const DAILY_RUN_WINDOW_MS = 2 * DAY_MS;

const CLOSED_ISSUE_STATUSES = new Set(['resolved', 'canceled', 'archived']);

const toMs = (value) => {
  if (value == null) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * An environment's status as one of 'blocked', 'needsInvestigation', 'ready'
 * or 'unknown'. QA Wolf has spelled the middle one both ways.
 */
export function normalizeEnvironmentStatus(status) {
  const key = String(status || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (key === 'blocked') return 'blocked';
  if (key === 'needsinvestigation') return 'needsInvestigation';
  if (key === 'ready') return 'ready';
  return 'unknown';
}

const ENV_RANK = { blocked: 3, needsInvestigation: 2, unknown: 1, ready: 0 };

/**
 * The workspace's environment status, worst first: one blocked environment
 * is what the row shows, because nobody can run against it. Preview
 * environments come and go with pull requests, so only static ones count.
 */
export function summarizeEnvironments(environments = []) {
  const statics = environments.filter((env) => env?.kind !== 'preview');
  if (statics.length === 0) return { status: 'unknown', count: 0, blocked: 0 };
  let worst = 'ready';
  let blocked = 0;
  for (const env of statics) {
    const status = normalizeEnvironmentStatus(env.status);
    if (status === 'blocked') blocked += 1;
    if (ENV_RANK[status] > ENV_RANK[worst]) worst = status;
  }
  return { status: worst, count: statics.length, blocked };
}

/**
 * The bug reports that belong to one environment: those reproduced there,
 * and those reproduced nowhere yet (filed by hand), which can only be
 * counted where they were filed. Without an environment every report counts.
 */
export function bugsInEnvironment(bugs = [], environmentId = null) {
  if (!environmentId) return bugs;
  return bugs.filter((bug) => {
    const reproductions = Array.isArray(bug?.reproductions) ? bug.reproductions : [];
    return (
      reproductions.length === 0 || reproductions.some((r) => r?.environmentId === environmentId)
    );
  });
}

/** Active and draft flow counts across the environments the scan read. */
export function countFlows(flowsByEnvironment = {}) {
  let active = 0;
  let draft = 0;
  for (const flows of Object.values(flowsByEnvironment)) {
    for (const flow of flows || []) {
      if (flow?.readiness === 'draft') draft += 1;
      else active += 1;
    }
  }
  return { active, draft };
}

/**
 * The environment the page counts for a workspace: the one recorded on the
 * page, else the workspace's default, else its first static one. Workspaces
 * keep several environments (a pilot's own beside a full-service Staging),
 * and adding them up double counts, so the row reads one.
 */
export function chooseEnvironment(
  environments = [],
  defaultEnvironmentId = null,
  preferredId = null,
) {
  const statics = environments.filter((env) => env?.kind !== 'preview');
  return (
    statics.find((env) => env.id === preferredId) ||
    statics.find((env) => env.id === defaultEnvironmentId) ||
    statics[0] ||
    null
  );
}

/**
 * The environments a trigger targets. Scheduled triggers name one
 * (`environmentId`); deployment triggers name a list (`environmentIds`).
 */
export function triggerEnvironmentIds(trigger) {
  const config = trigger?.configuration || {};
  if (Array.isArray(config.environmentIds)) return config.environmentIds;
  return config.environmentId ? [config.environmentId] : [];
}

/**
 * Whether a trigger selects at least one active flow in its environments, by
 * flow id or by tag. A trigger that selects nothing looks set up and runs
 * nothing, which is the failure this column exists to catch.
 */
export function triggerMatchesFlows(trigger, flowsByEnvironment = {}) {
  const action = trigger?.configuration?.action || {};
  const flows = triggerEnvironmentIds(trigger)
    .flatMap((id) => flowsByEnvironment[id] || [])
    .filter((flow) => flow?.readiness !== 'draft');
  const flowIds = new Set(flows.map((flow) => flow.flowId));
  if ((action.flowIds || []).some((id) => flowIds.has(id))) return true;
  const tags = new Set(action.tagNames || []);
  if (tags.size === 0) return false;
  return flows.some((flow) => (flow.tags || []).some((tag) => tags.has(tag)));
}

/**
 * The trigger column: how many unpaused triggers target the counted
 * environment, how many of those select no flow, and whether a scheduled one
 * that does select flows exists (the daily-run step needs one). Without an
 * `environmentId` every trigger counts.
 */
export function summarizeTriggers(triggers = [], flowsByEnvironment = {}, environmentId = null) {
  let count = 0;
  let empty = 0;
  let matchingSchedule = false;
  for (const trigger of triggers) {
    if (trigger?.isPaused) continue;
    if (environmentId && !triggerEnvironmentIds(trigger).includes(environmentId)) continue;
    count += 1;
    const matches = triggerMatchesFlows(trigger, flowsByEnvironment);
    if (!matches) empty += 1;
    if (matches && trigger?.configuration?.kind === 'schedule') matchingSchedule = true;
  }
  return { count, empty, matchingSchedule };
}

/** A run's status folded into pass, fail, running or other. */
export function runOutcome(status) {
  const key = String(status || '').toLowerCase();
  if (key.startsWith('pass') || key === 'success' || key === 'succeeded') return 'pass';
  if (key.startsWith('fail') || key === 'error' || key === 'errored') return 'fail';
  if (['running', 'queued', 'pending', 'created', 'started', 'inprogress'].includes(key)) {
    return 'running';
  }
  return 'other';
}

/** The last 24 hours of runs, and when the newest run of all was. */
export function summarizeRuns(runs = [], now = Date.now()) {
  const since = now - DAY_MS;
  const day = { total: 0, pass: 0, fail: 0, running: 0 };
  let lastRunAt = null;
  for (const run of runs) {
    const at = toMs(run?.createdAt);
    if (at == null) continue;
    if (lastRunAt == null || at > lastRunAt) lastRunAt = at;
    if (at < since) continue;
    day.total += 1;
    const outcome = runOutcome(run.status);
    if (outcome !== 'other') day[outcome] += 1;
  }
  return { ...day, lastRunAt };
}

/**
 * The bug column: open reports, how many of those nobody has prioritized,
 * how many were filed in the last 24 hours, and whether there has ever been
 * one (the first-bug step).
 */
export function summarizeBugs(bugs = [], now = Date.now()) {
  const since = now - DAY_MS;
  let open = 0;
  let unprioritized = 0;
  let newToday = 0;
  for (const bug of bugs) {
    const at = toMs(bug?.createdAt);
    if (at != null && at >= since) newToday += 1;
    if (CLOSED_ISSUE_STATUSES.has(bug?.status)) continue;
    open += 1;
    if (!bug?.priority || bug.priority === 'unprioritized') unprioritized += 1;
  }
  return {
    open,
    unprioritized,
    newToday,
    ever: bugs.length > 0,
    spike: newToday >= BUG_SPIKE_THRESHOLD,
  };
}

const yn = (value) => (value === true ? 'y' : value === false ? 'n' : 'u');

/**
 * The six activation steps, one character each, in STEPS order.
 *
 * - First flow: any active flow.
 * - Customer run: 'y' once a run was started by someone on the customer's
 *   side; unknown otherwise, since a run by someone we cannot place proves
 *   nothing either way.
 * - Daily run: a scheduled trigger that selects flows and a run in the last
 *   two days; 'n' without one.
 * - First bug: any bug report, open or closed.
 * - Failure owner and client tests: recorded on the page.
 */
export function activationSteps({
  flows,
  customerRun = null,
  triggers,
  runs,
  bugs,
  details = {},
  now = Date.now(),
}) {
  const daily =
    triggers.matchingSchedule &&
    runs.lastRunAt != null &&
    now - runs.lastRunAt <= DAILY_RUN_WINDOW_MS;
  return [
    flows.active > 0 ? 'y' : 'n',
    customerRun === true ? 'y' : 'u',
    daily ? 'y' : 'n',
    bugs.ever ? 'y' : 'n',
    details.failureOwner ? 'y' : 'u',
    yn(details.clientBuildingTests ?? null),
  ].join('');
}

/** Whole days from kickoff to now, or null without a kickoff date. */
export function dayOfOnboarding(kickoffOn, now = Date.now()) {
  const at = toMs(kickoffOn);
  if (at == null) return null;
  return Math.floor((now - at) / DAY_MS);
}

/**
 * The decision date: the end of a recorded pilot, else day 30, except for a
 * hybrid (self-managed) workspace, which has no end.
 */
export function decisionFor({ kickoffOn, pilotDays, segment }) {
  const at = toMs(kickoffOn);
  if (at == null) return null;
  if (pilotDays) return { at: at + pilotDays * DAY_MS, label: 'Pilot ends' };
  if (segment === 'hybrid') return null;
  return {
    at: at + DEFAULT_DECISION_DAY * DAY_MS,
    label: `Decision (day ${DEFAULT_DECISION_DAY})`,
  };
}

/**
 * Each step's target date and state against today: done, missed (the date
 * passed without it), unknown, or later (not due yet). Null without a
 * kickoff date.
 */
export function milestones({ kickoffOn, pilotDays, segment, activation, now = Date.now() }) {
  const at = toMs(kickoffOn);
  if (at == null) return null;
  const steps = STEPS.map((step, index) => {
    const due = at + step.day * DAY_MS;
    const flag = activation.charAt(index);
    let state;
    if (flag === 'y') state = 'done';
    else if (due > now) state = 'later';
    else if (flag === 'n') state = 'missed';
    else state = 'unknown';
    return { key: step.key, label: step.short, at: new Date(due).toISOString(), state };
  });
  const decision = decisionFor({ kickoffOn, pilotDays, segment });
  return {
    kickoffAt: new Date(at).toISOString(),
    steps,
    decision: decision
      ? {
          label: decision.label,
          at: new Date(decision.at).toISOString(),
          state: decision.at > now ? 'later' : 'unknown',
        }
      : null,
  };
}

/**
 * Stalled, Watch or On track, with the one sentence that says why.
 *
 * Stalled is a workspace going nowhere: no active flow, or flows that have
 * not run for a week. Watch is something that needs a look: an environment
 * nobody can run against, a daily run that failed, a trigger that runs
 * nothing, or a burst of new bugs.
 */
export function onboardingStatus({ flows, runs, triggers, bugs, environment, now = Date.now() }) {
  if (flows.active === 0) {
    return {
      status: 'Stalled',
      reason: triggers.count === 0 ? 'No active flows and no triggers.' : 'No active flows.',
    };
  }
  if (runs.lastRunAt == null || now - runs.lastRunAt > STALLED_AFTER_DAYS * DAY_MS) {
    const since = runs.lastRunAt == null ? 'No runs on record.' : null;
    return {
      status: 'Stalled',
      reason: since || `No runs since ${new Date(runs.lastRunAt).toISOString().slice(0, 10)}.`,
    };
  }
  if (environment.status === 'blocked') {
    return { status: 'Watch', reason: `${environment.blocked} environment(s) blocked.` };
  }
  if (runs.fail > 0 && runs.pass === 0) {
    return { status: 'Watch', reason: 'Every finished run in the last 24 hours failed.' };
  }
  if (triggers.empty > 0) {
    return { status: 'Watch', reason: `${triggers.empty} trigger(s) select no flow.` };
  }
  if (bugs.spike) {
    return { status: 'Watch', reason: `${bugs.newToday} bug reports filed in the last 24 hours.` };
  }
  if (environment.status === 'needsInvestigation') {
    return { status: 'Watch', reason: 'An environment needs investigation.' };
  }
  return { status: 'On track', reason: null };
}

const STATUS_ORDER = { Stalled: 0, Watch: 1, 'On track': 2, Unread: 3 };

/**
 * One workspace's row. `platform` is what the scan read from QA Wolf for it
 * (or `error` when that failed), `details` the page's own record, and
 * `customerRun` Task Wolf's answer (true, or null when it could not tell).
 */
export function buildRow({
  workspace,
  details = {},
  platform,
  customerRun = null,
  now = Date.now(),
}) {
  const base = {
    workspaceId: workspace.id,
    name: workspace.name,
    slug: workspace.slug || null,
    source: workspace.source,
    segment: SEGMENTS.includes(details.segment) ? details.segment : 'self',
    kickoffOn: details.kickoffOn ? new Date(details.kickoffOn).toISOString() : null,
    pilotDays: details.pilotDays ?? null,
    day: dayOfOnboarding(details.kickoffOn, now),
    linearIssue: details.linearIssue || null,
    ae: details.ae || null,
    csm: details.csm || null,
    failureOwner: details.failureOwner || null,
    clientBuildingTests: details.clientBuildingTests ?? null,
    nextStep: details.nextStep || null,
    // Runner minutes and AI credits are not in QA Wolf's public API yet.
    usage: null,
  };
  if (!platform || platform.error) {
    return {
      ...base,
      status: 'Unread',
      reason: platform?.error || 'Not scanned yet.',
      activation: 'uuuuuu',
      milestones: null,
    };
  }
  // Everything below counts the one environment the scan read (see
  // chooseEnvironment); the others are listed only for the picker.
  const counted = (platform.environments || []).find((env) => env.id === platform.environmentId);
  const flows = countFlows(platform.flowsByEnvironment);
  const environment = summarizeEnvironments(counted ? [counted] : []);
  const triggers = summarizeTriggers(
    platform.triggers,
    platform.flowsByEnvironment,
    platform.environmentId,
  );
  const runs = summarizeRuns(platform.runs, now);
  const bugs = summarizeBugs(bugsInEnvironment(platform.bugs, platform.environmentId), now);
  const activation = activationSteps({ flows, customerRun, triggers, runs, bugs, details, now });
  const { status, reason } = onboardingStatus({ flows, runs, triggers, bugs, environment, now });
  return {
    ...base,
    environmentId: counted?.id || null,
    environmentName: counted?.name || null,
    environments: (platform.environments || [])
      .filter((env) => env?.kind !== 'preview')
      .map((env) => ({
        id: env.id,
        name: env.name,
        isDefault: env.id === platform.defaultEnvironmentId,
      })),
    flows,
    environment,
    triggers,
    runs: { ...runs, lastRunAt: runs.lastRunAt ? new Date(runs.lastRunAt).toISOString() : null },
    bugs,
    activation,
    status,
    reason,
    milestones: milestones({ ...base, activation, now }),
  };
}

/** Rows in page order: stalled first, then watch, then on track; by name within. */
export function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      String(a.name).localeCompare(String(b.name)),
  );
}

/** The four summary tiles, counted from the rows themselves. */
export function summarize(rows) {
  const bySegment = Object.fromEntries(SEGMENTS.map((segment) => [segment, 0]));
  for (const row of rows) bySegment[row.segment] += 1;
  const dailyBad = rows.filter((row) => row.runs && row.runs.fail > 0 && row.runs.pass === 0);
  return {
    total: rows.length,
    bySegment,
    stalled: rows.filter((row) => row.status === 'Stalled').length,
    dailyBad: dailyBad.length,
    dailyBadNames: dailyBad.map((row) => row.name),
    blocked: rows.filter((row) => row.environment?.status === 'blocked').length,
  };
}
