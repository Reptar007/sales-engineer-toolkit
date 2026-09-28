/**
 * Minimal client for the Task Wolf MCP server.
 *
 * Task Wolf (the Dragons' internal ops tool) exposes its read-only tools over
 * MCP's Streamable HTTP transport: JSON-RPC 2.0 posted to one URL, answered as
 * plain JSON or as a short server-sent-event stream, authenticated with a
 * personal bearer token minted in Task Wolf -> Settings -> Connect Claude.
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
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

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

    if (response.status === 401 || response.status === 403) throw new TaskWolfAuthError();

    const newSession = response.headers?.get?.('mcp-session-id');
    if (newSession) sessionId = newSession;

    const rawText = await response.text();
    if (!response.ok) {
      const error = new Error(
        `Task Wolf MCP ${message.method} returned ${response.status}: ${rawText.slice(0, 300)}`,
      );
      error.code = 'TW_UPSTREAM';
      error.status = response.status;
      throw error;
    }
    if (!expectResponse) return null;

    const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
    const messages = contentType.includes('text/event-stream')
      ? parseSseBody(rawText)
      : rawText.trim()
        ? [JSON.parse(rawText)]
        : [];

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

  async function initialize() {
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

  /** Every tool the server offers, with its JSON schema; cached per client. */
  async function listTools({ force = false } = {}) {
    if (toolCatalog && !force) return toolCatalog;
    await initialize();
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page += 1) {
      const result = await request('tools/list', cursor ? { cursor } : {});
      tools.push(...(Array.isArray(result?.tools) ? result.tools : []));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    toolCatalog = tools;
    return tools;
  }

  async function toolSchema(name) {
    const tools = await listTools();
    return tools.find((t) => t.name === name)?.inputSchema || null;
  }

  /**
   * Call one tool and return its parsed answer. A stale session (404) is
   * re-initialized once; every other failure is thrown with a code.
   */
  async function callTool(name, args = {}) {
    await initialize();
    const params = { name, arguments: args };
    let result;
    try {
      result = await request('tools/call', params);
    } catch (error) {
      if (error.code === 'TW_UPSTREAM' && error.status === 404 && sessionId) {
        sessionId = null;
        initialized = null;
        await initialize();
        result = await request('tools/call', params);
      } else {
        throw error;
      }
    }
    return parseToolResult(result, name);
  }

  return {
    baseUrl,
    initialize,
    listTools,
    toolSchema,
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
