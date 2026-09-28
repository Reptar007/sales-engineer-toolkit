/**
 * Minimal client for QA Wolf's public API.
 *
 * The public API is a tRPC surface at `<base>/api/trpc/<procedure>` that takes
 * a superjson-wrapped `input` query string and a bearer key -- the same shape
 * the Howl Sheet already uses for `gitwolf.*`, and the same one the QA Wolf CLI
 * and MCP server speak (MCP tool names are these procedure paths with the dot
 * swapped for an underscore: `issue_find` is `issue.find`).
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
 * Call one read procedure.
 *
 * @param {string} procedure  e.g. "issue.find"
 * @param {object} input      the procedure's input object
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]  injectable for tests
 * @param {string} [options.baseUrl]
 * @param {string} [options.token]
 * @param {number} [options.timeoutMs]
 */
export async function qawQuery(procedure, input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = options.baseUrl || getQawBaseUrl();
  const token = options.token || getQawToken();
  const timeoutMs = options.timeoutMs ?? 30_000;

  const encoded = encodeURIComponent(JSON.stringify({ json: input ?? {} }));
  const url = `${baseUrl}/api/trpc/${procedure}?input=${encoded}`;

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const wrapped = new Error(`QA Wolf ${procedure} request failed: ${error?.message || error}`);
    wrapped.code = 'QAW_NETWORK';
    throw wrapped;
  }

  const rawText = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new QawAuthError();
  }
  if (!response.ok) {
    const error = new Error(
      `QA Wolf ${procedure} returned ${response.status}: ${rawText.slice(0, 300)}`,
    );
    error.code = 'QAW_UPSTREAM';
    error.status = response.status;
    throw error;
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    const error = new Error(`QA Wolf ${procedure} returned a non-JSON body.`);
    error.code = 'QAW_UPSTREAM';
    throw error;
  }

  if (body?.error) {
    const message = body.error?.json?.message || body.error?.message || 'unknown error';
    const error = new Error(`QA Wolf ${procedure} error: ${message}`);
    error.code = 'QAW_UPSTREAM';
    throw error;
  }

  return unwrapTrpcResponse(body);
}

/**
 * Every workspace the key can act on, each with the organization that owns it.
 * @returns {Promise<Array<{ id: string, name: string, slug: string, organizationName?: string }>>}
 */
export async function listWorkspaces(options = {}) {
  const data = await qawQuery('whoami', {}, options);
  const workspaces = Array.isArray(data?.workspaces)
    ? data.workspaces
    : data?.workspace
      ? [data.workspace]
      : null;
  if (!workspaces) {
    throw new Error(`Unexpected whoami shape. Got keys: ${Object.keys(data || {}).join(', ')}`);
  }
  return workspaces;
}

const OPEN_STATUSES = ['pending', 'inProgress', 'paused'];
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // 5,000 reports in one workspace would be its own emergency

/**
 * Every open maintenance report in one workspace, walking the cursor until the
 * API stops handing one back.
 */
export async function listOpenMaintenanceReports(workspaceId, options = {}) {
  const issues = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const input = { workspaceId, type: 'maintenance', statuses: OPEN_STATUSES, limit: PAGE_SIZE };
    if (cursor) input.cursor = cursor;
    const data = await qawQuery('issue.find', input, options);
    if (!Array.isArray(data?.issues)) {
      throw new Error(
        `Unexpected issue.find shape for ${workspaceId}. Got keys: ${Object.keys(data || {}).join(', ')}`,
      );
    }
    issues.push(...data.issues);
    cursor = data.nextCursor;
    if (!cursor || data.issues.length === 0) break;
  }
  return issues;
}
