/**
 * Lone Wolves -- reading the by-week CSV of the Metronome usage script
 * (Fahd and Henry's metronome_usage_by_user.py, run with --environment and
 * --by-week) into weekly totals for one workspace environment.
 *
 * The file has one row per week and user:
 *
 *   week_start,user,ai_credits,interactive_minutes,suite_minutes
 *   2026-10-26,someone@customer.com,120.5,40.2,31.0
 *   2026-10-26,(other environments),300,10,0
 *
 * Rows are summed per week. "(other environments)" is usage outside the
 * environment the script was run for, so it is left out; "(no user)" is the
 * environment's automatic work and counts. User emails are only read to tell
 * those apart and are never kept.
 *
 * `weeksFromEvents` gives the same weekly totals from Metronome's raw events,
 * for the "Pull from Metronome" button (metronomePull.js), by the script's
 * own matching rule.
 *
 * Pure, so the tests pin it without a database.
 */
import { OnboardingError } from './workspaceStore.js';
import { weekStartOf } from './usageShape.js';

export const OTHER_ENVIRONMENTS = '(other environments)';
const COLUMNS = ['week_start', 'user', 'ai_credits', 'interactive_minutes', 'suite_minutes'];
/** More than a year of weeks is not a pilot's file. */
const MAX_WEEKS = 60;

const invalid = (message) => new OnboardingError('ONBOARDING_INVALID', message);

/** One CSV line into fields; handles quoted fields with commas and "" escapes. */
export function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else field += ch;
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

const amount = (value, column, lineNo) => {
  const n = value === '' ? 0 : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw invalid(`Line ${lineNo}: ${column} must be a number, not "${value}".`);
  }
  return n;
};

const round2 = (n) => Math.round(n * 100) / 100;

const emptyWeek = (weekStart) => ({
  weekStart,
  aiCredits: 0,
  interactiveMinutes: 0,
  suiteMinutes: 0,
});

const finish = (weeks) =>
  [...weeks.values()]
    .sort((a, b) => a.weekStart - b.weekStart)
    .map((w) => ({
      weekStart: w.weekStart,
      aiCredits: round2(w.aiCredits),
      interactiveMinutes: round2(w.interactiveMinutes),
      suiteMinutes: round2(w.suiteMinutes),
    }));

/**
 * Whether a Metronome event belongs to the environment, by the script's
 * rule: suite runner time carries its environment; AI credits and
 * interactive runner time carry the chat session they ran in, matched to
 * the environment's sessions. AI work with neither (some run
 * investigations) is left out, so AI credits can read a little low.
 */
export function inEnvironment(properties = {}, environmentId, sessionIds) {
  if (properties.environmentId) return properties.environmentId === environmentId;
  const session = properties.testerSessionId || properties.sessionId;
  return Boolean(session) && sessionIds.has(session);
}

/**
 * Metronome usage events (from metronomeClient.pullEvents) into the same
 * weekly totals the CSV gives, for one environment, oldest first. Weeks
 * with no usage in the environment are not listed. Event types other than
 * AI credits and runner seconds are ignored.
 */
export function weeksFromEvents(events, environmentId, sessionIds = new Set()) {
  const weeks = new Map();
  for (const event of events) {
    const properties = event.properties || {};
    if (!inEnvironment(properties, environmentId, sessionIds)) continue;
    let add;
    if (event.event_type === 'ai_credits') add = { aiCredits: Number(properties.ai_credits) };
    else if (event.event_type === 'runner_seconds') {
      const minutes = Number(properties.seconds) / 60;
      add =
        properties.mode === 'interactive'
          ? { interactiveMinutes: minutes }
          : { suiteMinutes: minutes };
    } else continue;
    const [key, value] = Object.entries(add)[0];
    if (!Number.isFinite(value)) continue;
    const at = weekStartOf(Date.parse(event.timestamp));
    const week = weeks.get(at) || emptyWeek(at);
    week[key] += value;
    weeks.set(at, week);
  }
  return finish(weeks);
}

/**
 * The CSV's weekly totals for the environment, oldest first:
 * `[{ weekStart (ms, Monday 00:00 UTC), aiCredits, interactiveMinutes, suiteMinutes }]`.
 * Throws an OnboardingError naming the line when the file is not that CSV.
 */
export function parseMeteredCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw invalid('The CSV is empty.');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const index = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
  const missing = COLUMNS.filter((c) => index[c] < 0);
  if (missing.length) {
    throw invalid(
      `This is not the by-week usage CSV (missing ${missing.join(', ')}). ` +
        'Upload the usage-by-week-….csv the script writes with --by-week.',
    );
  }
  const weeks = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const lineNo = i + 1;
    const fields = splitCsvLine(lines[i]);
    const user = fields[index.user];
    if (user === OTHER_ENVIRONMENTS) continue;
    const day = fields[index.week_start];
    const at = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
    if (!Number.isFinite(at)) throw invalid(`Line ${lineNo}: "${day}" is not a YYYY-MM-DD date.`);
    if (weekStartOf(at) !== at) throw invalid(`Line ${lineNo}: ${day} is not a Monday.`);
    const week = weeks.get(at) || emptyWeek(at);
    week.aiCredits += amount(fields[index.ai_credits], 'ai_credits', lineNo);
    week.interactiveMinutes += amount(
      fields[index.interactive_minutes],
      'interactive_minutes',
      lineNo,
    );
    week.suiteMinutes += amount(fields[index.suite_minutes], 'suite_minutes', lineNo);
    weeks.set(at, week);
  }
  if (weeks.size === 0) throw invalid('The CSV has no weeks for this environment.');
  if (weeks.size > MAX_WEEKS) throw invalid(`The CSV has more than ${MAX_WEEKS} weeks.`);
  return finish(weeks);
}
