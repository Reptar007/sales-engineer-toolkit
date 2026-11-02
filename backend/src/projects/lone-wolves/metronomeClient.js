/**
 * Lone Wolves -- reading a customer's raw usage events from Metronome, the
 * way Fahd and Henry's metronome_usage_by_user.py does.
 *
 * It asks Metronome's own UI endpoint (the query behind its Usage events
 * page) with a token an editor copies from their Metronome session, since
 * there is no API key for this yet. The token lasts about a day; it is used
 * for one pull and never stored or logged. The endpoint is internal to
 * Metronome and can change without notice; a public-API key would replace
 * this file and nothing else.
 *
 * Read-only: the request carries Metronome's read-only header, and the query
 * is the same one the Usage events page runs.
 */
import { OnboardingError } from './workspaceStore.js';

export const METRONOME_URL = 'https://graphql.metronome.com/v1/graphql';
const PAGE_SIZE = 1000;
const ATTEMPTS = 6;
/** Stop rather than page forever if Metronome keeps answering. */
const MAX_PAGES = 200;

const QUERY = `query Events($environment_type: EnvironmentTypeEnum_enum!, $starting_after: timestamptz!, $ending_before: timestamptz!, $limit: Int!, $ingest_aliases: [String!]) {
  mri_events(environment_type: $environment_type, starting_after: $starting_after, ending_before: $ending_before, limit: $limit, ingest_aliases: $ingest_aliases) {
    transaction_id event_type timestamp properties is_duplicate
  }
}`;

export const TOKEN_REJECTED = 'METRONOME_TOKEN';

const rejected = () =>
  new OnboardingError(
    TOKEN_REJECTED,
    'Metronome turned the token down. Copy a fresh one (they last about a day) and try again.',
  );

/** The token as pasted, without a "Bearer " prefix or stray spaces. */
export function cleanToken(value) {
  return String(value || '')
    .trim()
    .replace(/^bearer\s+/i, '')
    .trim();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One page of events ending before `endingBefore`, retrying Metronome's passing errors. */
async function fetchPage({ token, aliases, start, endingBefore, fetchImpl, sleep }) {
  const body = JSON.stringify({
    operationName: 'Events',
    query: QUERY,
    variables: {
      environment_type: 'PRODUCTION',
      starting_after: start,
      ending_before: endingBefore,
      limit: PAGE_SIZE,
      ingest_aliases: aliases,
    },
  });
  let lastError = 'no answer';
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let payload;
    try {
      const res = await fetchImpl(METRONOME_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          origin: 'https://app.metronome.com',
          referer: 'https://app.metronome.com/',
          'x-metronome-readonly': 'true',
          'x-metronome-system': 'ui',
        },
        body,
      });
      if (res.status === 401 || res.status === 403) throw rejected();
      payload = res.ok ? await res.json() : { errors: [{ message: `HTTP ${res.status}` }] };
    } catch (error) {
      if (error?.code === TOKEN_REJECTED) throw error;
      payload = { errors: [{ message: error?.message || 'network error' }] };
    }
    if (!payload.errors) return payload.data?.mri_events || [];
    lastError = JSON.stringify(payload.errors);
    if (/JWT|JWS|unauthori[sz]ed|invalid.token/i.test(lastError)) throw rejected();
    await sleep(Math.min(2 ** attempt * 1000, 15000));
  }
  throw new OnboardingError(
    'METRONOME_FAILED',
    `Metronome kept failing (${lastError.slice(0, 200)}). Try again in a few minutes.`,
  );
}

/**
 * Every usage event for the customer between `start` and `end` (ISO, end
 * exclusive), duplicates dropped. Metronome answers newest first, a
 * thousand at a time, so it pages back by moving `ending_before` to the
 * oldest event seen (plus 1 ms, so events sharing that time are read again
 * rather than skipped; they are dropped by transaction id).
 */
export async function pullEvents({
  token,
  aliases,
  start,
  end,
  fetchImpl = fetch,
  sleep = wait,
  onProgress = () => {},
}) {
  const events = new Map();
  let endingBefore = end;
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo += 1) {
    const page = await fetchPage({ token, aliases, start, endingBefore, fetchImpl, sleep });
    let fresh = 0;
    for (const event of page) {
      if (!events.has(event.transaction_id)) fresh += 1;
      events.set(event.transaction_id, event);
    }
    onProgress(events.size);
    if (page.length < PAGE_SIZE || fresh === 0) break;
    const oldest = Math.min(...page.map((event) => Date.parse(event.timestamp)));
    endingBefore = new Date(oldest + 1).toISOString();
  }
  return [...events.values()].filter((event) => !event.is_duplicate);
}
