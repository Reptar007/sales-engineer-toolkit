/**
 * Minimal client for the Task Wolf MCP server.
 *
 * Task Wolf (the Dragons' internal ops tool) exposes its read-only tools over
 * MCP's Streamable HTTP transport: JSON-RPC 2.0 posted to one URL, answered as
 * plain JSON or as a short server-sent-event stream, authenticated with a
 * bearer token minted in Task Wolf -> Settings -> Connect Claude. The token's
 * owner decides what Task Wolf will tell the server, and it lasts 90 days
 * (see getTaskWolfTokenExpiry).
 * The same server backs the `task-wolf` MCP in Claude Code / Claude Desktop;
 * nothing here is specific to this page except the client name.
 *
 * Only `initialize`, `tools/list` and `tools/call` are needed, so the protocol
 * is spoken directly with `fetch` rather than pulling in the MCP SDK. The
 * server is stateless (no session affinity), but a session id is honoured if
 * it hands one back.
 *
 * Read-only by construction: the Task Wolf MCP has no write tools in v1, and
 * this client never calls anything but the three methods above.
 */

const DEFAULT_MCP_URL = 'https://task-wolf.com/apis/task-wolf/mcp';
const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'saleswolf-bone-pile', version: '1.0.0' };

export const TW_INVALID_TOKEN_MESSAGE =
  'Task Wolf MCP token is invalid or expired. Mint a new one in Task Wolf -> Settings -> Connect Claude and update TASK_WOLF_MCP_TOKEN.';

export class TaskWolfConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskWolfConfigError';
    this.code = 'TW_CONFIG';
  }
}

export class TaskWolfAuthError extends Error {
  constructor(message = TW_INVALID_TOKEN_MESSAGE) {
    super(message);
    this.name = 'TaskWolfAuthError';
    this.code = 'TW_AUTH';
  }
}

/**
 * 403: the token is good but may not read what was asked for. Unlike a 401 it
 * says nothing about the next customer, so it never stops a pass on sight.
 */
export class TaskWolfForbiddenError extends Error {
  constructor(message = 'Task Wolf refused the request (403): this token may not read that.') {
    super(message);
    this.name = 'TaskWolfForbiddenError';
    this.code = 'TW_FORBIDDEN';
    this.status = 403;
  }
}

/** A tool answered, but with `isError` or a JSON-RPC error (bad arguments, no such customer). */
export class TaskWolfToolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TaskWolfToolError';
    this.code = 'TW_TOOL';
    this.tool = details.tool || null;
    this.rpcCode = details.rpcCode ?? null;
    this.data = details.data ?? null;
  }
}

export function getTaskWolfMcpUrl(env = process.env) {
  const raw = (env.TASK_WOLF_MCP_URL || DEFAULT_MCP_URL).trim();
  return raw.replace(/\/+$/, '');
}

export function isTaskWolfConfigured(env = process.env) {
  return Boolean((env.TASK_WOLF_MCP_TOKEN || '').trim());
}

export function getTaskWolfToken(env = process.env) {
  const token = (env.TASK_WOLF_MCP_TOKEN || '').trim();
  if (!token) {
    throw new TaskWolfConfigError(
      'TASK_WOLF_MCP_TOKEN is not configured on the server, so Task Wolf data is unavailable.',
    );
  }
  return token;
}

/**
 * TASK_WOLF_MCP_TOKEN_EXPIRES_ON as set, trimmed, or null when unset. Tokens
 * last 90 days from minting, and Task Wolf does not say when one runs out, so
 * this is how the server knows. Whether it is a date at all is
 * getTaskWolfTokenExpiry's to say.
 */
export function getTaskWolfTokenExpiresOn(env = process.env) {
  return (env.TASK_WOLF_MCP_TOKEN_EXPIRES_ON || '').trim() || null;
}

// How many days before the token's expiry date the page starts to warn.
export const TOKEN_EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A YYYY-MM-DD that names a real day, as ms at its UTC midnight; null for anything else. */
function parseCalendarDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const ms = Date.UTC(year, month - 1, day);
  // Date.UTC rolls 2026-02-30 over into March; a day that does not exist is not a date.
  return new Date(ms).toISOString().slice(0, 10) === text ? ms : null;
}

/**
 * Where the Task Wolf token stands against TASK_WOLF_MCP_TOKEN_EXPIRES_ON,
 * worked out on every call so a changed setting or a new day counts at once.
 * The date is a calendar day and the token is taken to work through it:
 * `daysLeft` counts whole UTC days from today to it, 0 on the day itself. It
 * is `expiring` from TOKEN_EXPIRY_WARNING_DAYS before the date through the
 * date, and `expired` from the day after. `none` with no date or no token to
 * date; `invalid` for a value that is not a real YYYY-MM-DD, which is never
 * echoed back, in case a token was pasted into the wrong setting.
 *
 * @returns {{ expiresOn: string|null, daysLeft: number|null, state: 'none'|'ok'|'expiring'|'expired'|'invalid' }}
 */
export function getTaskWolfTokenExpiry(env = process.env, now = Date.now()) {
  const expiresOn = getTaskWolfTokenExpiresOn(env);
  if (!expiresOn || !isTaskWolfConfigured(env)) {
    return { expiresOn: null, daysLeft: null, state: 'none' };
  }
  const expiryDay = parseCalendarDay(expiresOn);
  if (expiryDay === null) return { expiresOn: null, daysLeft: null, state: 'invalid' };
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const daysLeft = Math.round((expiryDay - today) / DAY_MS);
  let state = 'ok';
  if (daysLeft < 0) state = 'expired';
  else if (daysLeft <= TOKEN_EXPIRY_WARNING_DAYS) state = 'expiring';
  return { expiresOn, daysLeft, state };
}

/**
 * Parse a `text/event-stream` body into the JSON-RPC messages it carried.
 * Events are blank-line separated; each `data:` line is one line of the
 * payload (multi-line data is joined with "\n"); comments (`:`) are dropped.
 * Non-JSON data is ignored rather than fatal, so a keep-alive never breaks a
 * response.
 */
export function parseSseBody(text) {
  const messages = [];
  const events = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/);
  for (const event of events) {
    const dataLines = [];
    for (const line of event.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) continue;
    try {
      messages.push(JSON.parse(dataLines.join('\n')));
    } catch {
      // keep-alive or partial frame; nothing to do
    }
  }
  return messages;
}

/**
 * Turn a `tools/call` result into plain data. `structuredContent` wins when the
 * server sends it; otherwise the text blocks are joined and parsed as JSON if
 * they look like JSON, else returned as a string. `isError` becomes a throw so
 * a wrong customer name never gets tallied as "no maintenance".
 */
export function parseToolResult(result, toolName = 'tool') {
  if (!result || typeof result !== 'object') {
    throw new TaskWolfToolError(`Task Wolf ${toolName} returned no result.`, { tool: toolName });
  }
  const text = (Array.isArray(result.content) ? result.content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (result.isError) {
    throw new TaskWolfToolError(`Task Wolf ${toolName}: ${text || 'tool reported an error'}`, {
      tool: toolName,
    });
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  if (!text) return null;
  if (/^[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through: the tool answered prose that merely starts with a brace
    }
  }
  return text;
}

/**
 * Create a client bound to one server and token. Nothing is sent until the
 * first call; `initialize` runs once and is retried if the server forgets the
 * session (404 on a session id).
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]  injectable for tests
 * @param {string} [options.baseUrl]
 * @param {string} [options.token]
 * @param {number} [options.timeoutMs]        per request; tools budget ~60 s server-side
 */
export function createTaskWolfClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = options.baseUrl || getTaskWolfMcpUrl();
  const timeoutMs = options.timeoutMs ?? 60_000;
  let token = options.token || null;
  let nextId = 1;
  let sessionId = null;
  let initialized = null; // promise while/after initialize runs
  let serverInfo = null;
  let toolCatalog = null; // cached tools/list

  function authToken() {
    if (!token) token = getTaskWolfToken();
    return token;
  }

  async function post(message, { expectResponse = true } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${authToken()}`,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    const sentSession = sessionId;
    if (sentSession) headers['Mcp-Session-Id'] = sentSession;

    let response;
    try {
      response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const wrapped = new Error(
        `Task Wolf MCP ${message.method} request failed: ${error?.message || error}`,
      );
      wrapped.code = 'TW_NETWORK';
      throw wrapped;
    }

    if (response.status === 401) throw new TaskWolfAuthError();

    // An answer that arrives late, to a request sent under an older session,
    // must not bring that session back.
    const newSession = response.headers?.get?.('mcp-session-id');
    if (newSession && sessionId === sentSession) sessionId = newSession;

    let rawText;
    try {
      rawText = await response.text();
    } catch (error) {
      // The headers arrived and the body did not: a timeout or a reset mid-read.
      const wrapped = new Error(
        `Task Wolf MCP ${message.method} response could not be read: ${error?.message || error}`,
      );
      wrapped.code = 'TW_NETWORK';
      throw wrapped;
    }
    if (response.status === 403) {
      throw new TaskWolfForbiddenError(
        `Task Wolf MCP ${message.method} returned 403: ${rawText.slice(0, 300)}`,
      );
    }
    if (!response.ok) {
      const error = new Error(
        `Task Wolf MCP ${message.method} returned ${response.status}: ${rawText.slice(0, 300)}`,
      );
      error.code = 'TW_UPSTREAM';
      error.status = response.status;
      error.sessionId = sentSession;
      throw error;
    }
    if (!expectResponse) return null;

    const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
    let messages = [];
    if (contentType.includes('text/event-stream')) {
      messages = parseSseBody(rawText);
    } else if (rawText.trim()) {
      try {
        messages = [JSON.parse(rawText)];
      } catch {
        const error = new Error(
          `Task Wolf MCP ${message.method} returned a body that is not JSON: ${rawText.slice(0, 300)}`,
        );
        error.code = 'TW_UPSTREAM';
        throw error;
      }
    }

    const reply = messages.find((m) => m && m.id === message.id);
    if (!reply) {
      const error = new Error(
        `Task Wolf MCP ${message.method} sent no response for request ${message.id}.`,
      );
      error.code = 'TW_UPSTREAM';
      throw error;
    }
    if (reply.error) {
      throw new TaskWolfToolError(
        `Task Wolf MCP ${message.method}: ${reply.error.message || 'error'}`,
        {
          tool: message.params?.name || message.method,
          rpcCode: reply.error.code,
          data: reply.error.data,
        },
      );
    }
    return reply.result;
  }

  function request(method, params = {}) {
    const id = nextId;
    nextId += 1;
    return post({ jsonrpc: '2.0', id, method, params });
  }

  function initialize() {
    if (!initialized) {
      initialized = (async () => {
        let result = null;
        try {
          result = await request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO,
          });
        } catch (error) {
          // A stateless server that keeps one transport answers a second
          // handshake with "already initialized"; that is success, not failure.
          if (!(error.code === 'TW_TOOL' && /already initialized/i.test(error.message)))
            throw error;
        }
        serverInfo = result?.serverInfo || null;
        // Fire-and-forget by protocol: a server that dislikes the notification
        // (some stateless ones answer 400) still serves tool calls fine.
        await post(
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { expectResponse: false },
        ).catch((error) => {
          if (error.code === 'TW_AUTH') throw error;
        });
        return result;
      })().catch((error) => {
        initialized = null; // let the next call try again
        throw error;
      });
    }
    return initialized;
  }

  /**
   * Run `send` once the handshake is done. A stale-session recovery may replace
   * the handshake this call started out waiting for, so it waits until the one
   * it waited for is still the current one, and sends without another pause.
   */
  async function whenReady(send) {
    let handshake;
    do {
      handshake = initialize();
      await handshake;
    } while (handshake !== initialized);
    return send();
  }

  /**
   * Run `send` under the current session. If the server has forgotten the
   * session a request went out under (404), the handshake is redone and `send`
   * runs once more, never twice. Calls in flight together share one handshake:
   * whoever sees the 404 first drops the session, the rest find it already
   * dropped or replaced and wait for the same `initialize`.
   */
  async function inSession(send) {
    try {
      return await whenReady(send);
    } catch (error) {
      const stale = error.code === 'TW_UPSTREAM' && error.status === 404 && error.sessionId;
      if (!stale) throw error;
      if (sessionId === stale) {
        sessionId = null;
        initialized = null;
      }
      return whenReady(send);
    }
  }

  /**
   * Every tool the server offers, with its JSON schema; cached per client. A
   * stale session (404) restarts the listing once, from its first page.
   */
  async function listTools({ force = false } = {}) {
    if (toolCatalog && !force) return toolCatalog;
    const tools = await inSession(async () => {
      const listed = [];
      let cursor;
      for (let page = 0; page < 20; page += 1) {
        const result = await request('tools/list', cursor ? { cursor } : {});
        listed.push(...(Array.isArray(result?.tools) ? result.tools : []));
        cursor = result?.nextCursor;
        if (!cursor) break;
      }
      return listed;
    });
    toolCatalog = tools;
    return tools;
  }

  /**
   * Call one tool and return its parsed answer. A stale session (404) is
   * re-initialized once; every other failure is thrown with a code.
   */
  async function callTool(name, args = {}) {
    const result = await inSession(() => request('tools/call', { name, arguments: args }));
    return parseToolResult(result, name);
  }

  return {
    baseUrl,
    initialize,
    listTools,
    callTool,
    getServerInfo: () => serverInfo,
  };
}

let sharedClient = null;

/** One client per process, so `initialize` and the tool catalog are paid once. */
export function getSharedTaskWolfClient() {
  if (!sharedClient) sharedClient = createTaskWolfClient();
  return sharedClient;
}

/** Test hook. */
export function resetSharedTaskWolfClient() {
  sharedClient = null;
}
