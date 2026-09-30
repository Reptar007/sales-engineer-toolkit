/**
 * Minimal client for QA Wolf's public API, the one the QA Wolf CLI speaks.
 *
 * Two surfaces, both behind the same bearer key:
 * - Procedures are tRPC at `<base>/api/trpc/public.<name>` with a
 *   superjson-wrapped `input` query string. The `public.` namespace matters: the
 *   same `/api/trpc` also serves the web app's own procedures (the Howl Sheet's
 *   `gitwolf.*`), and a bare public name such as `issue.find` answers 404
 *   "The app is out of date". MCP tool names are the public names with the dot
 *   swapped for an underscore: `issue_find` is `public.issue.find`.
 * - Identity is plain REST under `<base>/api/v0/identity`. There is no tRPC
 *   `whoami`; `identity/organizations` is what lists workspaces, and unlike
 *   `identity` it includes the reach of a QA Wolf admin or employee key, which
 *   is how the scan sees every customer.
 *
 * Only reads live here. Nothing on this page writes to QA Wolf.
 */

const DEFAULT_BASE_URL = 'https://app.qawolf.com';

export const QAW_INVALID_TOKEN_MESSAGE =
  'QA Wolf access token is invalid or expired. Please reach out to an admin to update the QA Wolf Bearer token.';

/**
 * Tagged so the route can answer 401 instead of the generic 502 used for other
 * upstream failures, without sniffing message strings.
 */
export class QawAuthError extends Error {
  constructor(message = QAW_INVALID_TOKEN_MESSAGE) {
    super(message);
    this.name = 'QawAuthError';
    this.code = 'QAW_AUTH';
  }
}

/**
 * The key is fine but may not read this one thing (a workspace it was not
 * granted, say). Kept apart from QawAuthError so one locked workspace is
 * tallied as a failure instead of ending the scan as a dead key.
 */
export class QawForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QawForbiddenError';
    this.code = 'QAW_FORBIDDEN';
    this.status = 403;
  }
}

export class QawConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QawConfigError';
    this.code = 'QAW_CONFIG';
  }
}

/** Where the API lives; overridable so staging can be pointed at in dev. */
export function getQawBaseUrl(env = process.env) {
  const raw = (env.QAW_BASE_URL || DEFAULT_BASE_URL).trim();
  return raw.replace(/\/+$/, '');
}

/**
 * Bearer key for the public API. `QAW_BEARER_TOKEN` is the name the rest of
 * the app already uses; `QAWOLF_API_KEY` is accepted too because that is what
 * the QA Wolf CLI calls the same credential.
 */
export function getQawToken(env = process.env) {
  const token = (env.QAW_BEARER_TOKEN || env.QAWOLF_API_KEY || '').trim();
  if (!token) {
    throw new QawConfigError(
      'QAW_BEARER_TOKEN is not configured on the server, so the maintenance backlog cannot be read.',
    );
  }
  return token;
}

/**
 * Unwrap a tRPC response body. superjson responses nest the payload under
 * `result.data.json`; plain-json ones under `result.data`. Anything else is
 * returned as-is so the caller's shape check produces a useful error.
 */
export function unwrapTrpcResponse(body) {
  if (body && typeof body === 'object' && body.result && 'data' in body.result) {
    const data = body.result.data;
    const isSuperjsonEnvelope =
      data &&
      typeof data === 'object' &&
      'json' in data &&
      Object.keys(data).every((key) => key === 'json' || key === 'meta');
    return isSuperjsonEnvelope ? data.json : data;
  }
  return body;
}

/**
 * GET one path of the public API and parse its JSON body. `label` names the
 * call in every error message. Shared by the tRPC procedures and the REST
 * identity endpoint so both classify failures the same way.
 *
 * @param {string} path   e.g. "/api/v0/identity/organizations"
 * @param {string} label  e.g. "identity/organizations"
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]  injectable for tests
 * @param {string} [options.baseUrl]
 * @param {string} [options.token]
 * @param {number} [options.timeoutMs]
 */
async function getJson(path, label, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = options.baseUrl || getQawBaseUrl();
  const token = options.token || getQawToken();
  const timeoutMs = options.timeoutMs ?? 30_000;

  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const wrapped = new Error(`QA Wolf ${label} request failed: ${error?.message || error}`);
    wrapped.code = 'QAW_NETWORK';
    throw wrapped;
  }

  // The status alone says the key is dead, so a 401 whose body never arrives
  // still stops the scan instead of being tallied as a network blip.
  if (response.status === 401) {
    throw new QawAuthError();
  }
  if (response.status === 403) {
    const forbiddenText = await response.text().catch(() => '');
    throw new QawForbiddenError(`QA Wolf ${label} returned 403: ${forbiddenText.slice(0, 300)}`);
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch (error) {
    // The headers arrived and the body did not: a timeout or a reset mid-read.
    const wrapped = new Error(
      `QA Wolf ${label} response could not be read: ${error?.message || error}`,
    );
    wrapped.code = 'QAW_NETWORK';
    throw wrapped;
  }

  if (!response.ok) {
    const error = new Error(
      `QA Wolf ${label} returned ${response.status}: ${rawText.slice(0, 300)}`,
    );
    error.code = 'QAW_UPSTREAM';
    error.status = response.status;
    throw error;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const error = new Error(`QA Wolf ${label} returned a non-JSON body.`);
    error.code = 'QAW_UPSTREAM';
    throw error;
  }
}

/**
 * Call one read procedure of the public API.
 *
 * @param {string} procedure  the full tRPC path, e.g. "public.issue.find"
 * @param {object} input      the procedure's input object
 * @param {object} [options]  as for getJson
 */
export async function qawQuery(procedure, input, options = {}) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input ?? {} }));
  const body = await getJson(`/api/trpc/${procedure}?input=${encoded}`, procedure, options);

  if (body?.error) {
    const message = body.error?.json?.message || body.error?.message || 'unknown error';
    const error = new Error(`QA Wolf ${procedure} error: ${message}`);
    error.code = 'QAW_UPSTREAM';
    throw error;
  }

  return unwrapTrpcResponse(body);
}

/**
 * Every workspace the key can act on, each with the organization that owns it,
 * from `identity/organizations` (organizations[].workspaces[]).
 * @returns {Promise<Array<{ id: string, name: string, slug: string, organizationName: string }>>}
 */
export async function listWorkspaces(options = {}) {
  const data = await getJson('/api/v0/identity/organizations', 'identity/organizations', options);
  if (!Array.isArray(data?.organizations)) {
    const error = new Error(
      `Unexpected identity/organizations shape. Got keys: ${Object.keys(data || {}).join(', ')}`,
    );
    error.code = 'QAW_UPSTREAM';
    throw error;
  }
  return data.organizations.flatMap((organization) =>
    (Array.isArray(organization?.workspaces) ? organization.workspaces : []).map((workspace) => ({
      ...workspace,
      organizationName: organization.name || '',
    })),
  );
}

const OPEN_STATUSES = ['pending', 'inProgress', 'paused'];
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // 5,000 reports in one workspace would be its own emergency

/**
 * The open maintenance reports in one workspace, walking the cursor until the
 * API stops handing one back or MAX_PAGES have been read. `truncated` is true
 * when QA Wolf has more than `issues`, so every count made from them is a
 * floor: the walk stopped at MAX_PAGES with a cursor still in hand, and one
 * more report was waiting behind it. It is true too when asking for that one
 * report failed, though QA Wolf may then have no more: nothing says which, so
 * the list is treated as cut short, and what was read still counts as a floor.
 * The page and the Slack digest say QA Wolf has more either way.
 *
 * @returns {Promise<{ issues: Array<object>, truncated: boolean }>}
 */
export async function listOpenMaintenanceReports(workspaceId, options = {}) {
  const readPage = async (cursor, limit) => {
    const input = { workspaceId, type: 'maintenance', statuses: OPEN_STATUSES, limit };
    if (cursor) input.cursor = cursor;
    const data = await qawQuery('public.issue.find', input, options);
    if (!Array.isArray(data?.issues)) {
      throw new Error(
        `Unexpected public.issue.find shape for ${workspaceId}. Got keys: ${Object.keys(data || {}).join(', ')}`,
      );
    }
    return data;
  };

  const issues = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await readPage(cursor, PAGE_SIZE);
    issues.push(...data.issues);
    cursor = data.nextCursor;
    if (!cursor || data.issues.length === 0) return { issues, truncated: false };
  }
  // A cursor alone does not say there is more: above, an empty page behind one
  // is the end. So ask for one report behind it, and call the list cut short
  // only if there is one. That report is not added; `issues` is what the walk read.
  let beyond;
  try {
    beyond = await readPage(cursor, 1);
  } catch (error) {
    // This question only decides the flag, so its failure must not cost the
    // reports already read: they count, as floors. A dead key still stops the scan.
    if (error?.code === 'QAW_AUTH') throw error;
    return { issues, truncated: true };
  }
  return { issues, truncated: beyond.issues.length > 0 };
}
