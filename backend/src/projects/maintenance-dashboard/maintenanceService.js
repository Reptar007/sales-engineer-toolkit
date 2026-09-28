/**
 * Builds and caches the maintenance backlog snapshot.
 *
 * One snapshot is ~1,300 `issue.find` calls (one per workspace the key can
 * see), which is minutes of fan-out, so the page never waits on a live scan:
 * a GET answers the cached snapshot, or a "building" status with progress
 * while the first scan runs in the background. A scan that fails on a few
 * workspaces still produces a snapshot -- the failures ride along in
 * `errors`, so the page can say "1,290 of 1,301 scanned" instead of showing
 * a number that is quietly short.
 *
 * The cache is per-process. Heroku restarts the dyno daily, so the first
 * request after a restart rebuilds it; that is acceptable for a page read a
 * few times a day, and it keeps this change free of schema migrations.
 */
import { listWorkspaces, listOpenMaintenanceReports } from './qawolfClient.js';
import { buildSnapshot, parseExcludedSlugs } from './maintenanceShape.js';
import {
  TaskWolfConfigError,
  getSharedTaskWolfClient,
  isTaskWolfConfigured,
} from './taskWolfMcpClient.js';
import {
  mergeTaskWolf,
  normalizeMaintenanceStatus,
  normalizeTasks,
  pickCustomerArguments,
  pickTaskArguments,
  summarizeTaskWolfCustomer,
} from './taskWolfShape.js';

const DEFAULT_TTL_MINUTES = 6 * 60;
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 16;
const DEFAULT_TASK_WOLF_CONCURRENCY = 4;
const MAX_TASK_WOLF_CONCURRENCY = 8;

export const TASK_WOLF_MAINTENANCE_TOOL = 'get_maintenance_status';
export const TASK_WOLF_TASKS_TOOL = 'find_tasks';

const state = {
  snapshot: null, // last completed snapshot
  builtAt: 0, // Date.now() when it completed
  building: null, // in-flight promise, if any
  progress: null, // { scanned, total, startedAt, failed }
  lastError: null, // last whole-scan failure (auth, config, whoami)
};

function readNumberEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getCacheTtlMs() {
  return readNumberEnv('MAINTENANCE_DASHBOARD_CACHE_TTL_MINUTES', DEFAULT_TTL_MINUTES) * 60 * 1000;
}

export function getScanConcurrency() {
  return Math.min(
    MAX_CONCURRENCY,
    readNumberEnv('MAINTENANCE_DASHBOARD_CONCURRENCY', DEFAULT_CONCURRENCY),
  );
}

/** Task Wolf's tools each carry a real query, so the fan-out is gentler. */
export function getTaskWolfConcurrency() {
  return Math.min(
    MAX_TASK_WOLF_CONCURRENCY,
    readNumberEnv('TASK_WOLF_CONCURRENCY', DEFAULT_TASK_WOLF_CONCURRENCY),
  );
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Returns results in
 * input order; a worker's throw is captured as `{ error }` rather than
 * aborting the whole batch, so one broken workspace cannot hide the rest.
 * `onSettled` may throw to abort: the remaining items are skipped and the
 * throw is rethrown once the in-flight workers settle.
 */
export async function mapWithConcurrency(items, limit, worker, onSettled) {
  const results = new Array(items.length);
  let next = 0;
  let abort = null;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !abort) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { error };
      }
      if (onSettled && !abort) {
        try {
          onSettled(results[index], index);
        } catch (error) {
          abort = error;
        }
      }
    }
  });
  await Promise.all(lanes);
  if (abort) throw abort;
  return results;
}

/**
 * Ask Task Wolf about one customer: open maintenance with blocked status, and
 * the open maintenance tasks on the board. Either half may fail on its own;
 * an auth failure is rethrown so the caller can stop asking.
 */
async function queryTaskWolfCustomer(client, schemas, customer, now) {
  const workspace = { id: customer.workspaceId, slug: customer.slug, name: customer.name };
  const result = { maintenance: null, tasks: null, errors: [] };

  const attempts = [
    {
      tool: TASK_WOLF_MAINTENANCE_TOOL,
      schema: schemas.maintenance,
      pick: pickCustomerArguments,
      apply: (raw) => {
        result.maintenance = normalizeMaintenanceStatus(raw, now);
        return result.maintenance;
      },
    },
    {
      tool: TASK_WOLF_TASKS_TOOL,
      schema: schemas.tasks,
      pick: pickTaskArguments,
      apply: (raw) => {
        result.tasks = normalizeTasks(raw, now);
        return result.tasks;
      },
    },
  ];

  for (const attempt of attempts) {
    if (attempt.schema === undefined) continue; // the server does not offer this tool
    const picked = attempt.pick(attempt.schema, workspace);
    if (!picked) {
      result.errors.push({
        tool: attempt.tool,
        message: `No customer argument recognised in the ${attempt.tool} schema (${Object.keys(
          attempt.schema?.properties || {},
        ).join(', ')}).`,
      });
      continue;
    }
    try {
      const normalized = attempt.apply(await client.callTool(attempt.tool, picked.arguments));
      if (normalized === null) {
        result.errors.push({
          tool: attempt.tool,
          message: `${attempt.tool} answered prose rather than JSON, so it was not counted.`,
        });
      }
    } catch (error) {
      if (error.code === 'TW_AUTH') throw error;
      result.errors.push({ tool: attempt.tool, message: error.message || String(error) });
    }
  }
  return result;
}

/**
 * Second pass: fold Task Wolf's view (blocked vs actionable, who is on it)
 * into a platform snapshot. Only customers with backlog are asked, demos
 * skipped, so this is a few hundred calls rather than 1,300. Never throws:
 * a missing token, an expired token or a server-side failure lands in
 * `snapshot.taskWolf.error` and the page says so beside the platform data,
 * which is still right.
 */
export async function enrichWithTaskWolf(
  snapshot,
  { client, concurrency = getTaskWolfConcurrency(), onProgress, now = Date.now } = {},
) {
  const targets = snapshot.customers.filter((c) => !c.isDemo);
  const meta = {
    enabled: true,
    errors: [],
    customersQueried: targets.length,
    startedAt: new Date(now()).toISOString(),
    tools: null,
  };
  const byWorkspace = new Map();

  const finish = () => {
    meta.finishedAt = new Date(now()).toISOString();
    return mergeTaskWolf(snapshot, byWorkspace, meta);
  };

  let tools;
  try {
    tools = await client.listTools();
  } catch (error) {
    meta.error = { code: error.code || 'TW_UPSTREAM', message: error.message };
    return finish();
  }
  const findSchema = (name) => {
    const tool = tools.find((t) => t.name === name);
    return tool ? tool.inputSchema || null : undefined;
  };
  const schemas = {
    maintenance: findSchema(TASK_WOLF_MAINTENANCE_TOOL),
    tasks: findSchema(TASK_WOLF_TASKS_TOOL),
  };
  meta.tools = {
    maintenance: schemas.maintenance !== undefined,
    tasks: schemas.tasks !== undefined,
  };
  if (schemas.maintenance === undefined && schemas.tasks === undefined) {
    meta.error = {
      code: 'TW_TOOLS',
      message: `Task Wolf MCP offers neither ${TASK_WOLF_MAINTENANCE_TOOL} nor ${TASK_WOLF_TASKS_TOOL}.`,
    };
    return finish();
  }

  const progress = {
    phase: 'taskwolf',
    scanned: 0,
    total: targets.length,
    failed: 0,
    startedAt: meta.startedAt,
  };
  if (onProgress) onProgress({ ...progress });

  try {
    await mapWithConcurrency(
      targets,
      concurrency,
      (customer) => queryTaskWolfCustomer(client, schemas, customer, now()),
      (result, index) => {
        const customer = targets[index];
        if (result.error) {
          if (result.error.code === 'TW_AUTH') throw result.error;
          progress.failed += 1;
          meta.errors.push({
            workspaceId: customer.workspaceId,
            workspaceName: customer.name,
            message: result.error.message || String(result.error),
          });
        } else {
          const answer = result.value;
          if (answer.maintenance || answer.tasks) {
            byWorkspace.set(customer.workspaceId, summarizeTaskWolfCustomer(answer));
          }
          if (answer.errors.length) progress.failed += 1;
          for (const err of answer.errors) {
            meta.errors.push({
              workspaceId: customer.workspaceId,
              workspaceName: customer.name,
              tool: err.tool,
              message: err.message,
            });
          }
        }
        progress.scanned += 1;
        if (onProgress) onProgress({ ...progress });
      },
    );
  } catch (error) {
    // Auth died mid-way: keep what was gathered, say why the rest is missing.
    meta.error = { code: error.code || 'TW_UPSTREAM', message: error.message };
  }
  return finish();
}

/** The Task Wolf client the scan should use, or null when no token is set. */
export function defaultTaskWolfClient() {
  return isTaskWolfConfigured() ? getSharedTaskWolfClient() : null;
}

/**
 * Diagnostics: what Task Wolf answers for one customer, live and uncached --
 * the schema each tool declares, the arguments we derived from it, the raw
 * answer and the normalized reading side by side. This is how to check the
 * field mapping in `taskWolfShape.js` against the real server.
 */
export async function probeTaskWolfCustomer(
  workspace,
  { client = defaultTaskWolfClient(), now = Date.now } = {},
) {
  if (!client) {
    throw new TaskWolfConfigError('TASK_WOLF_MCP_TOKEN is not set, so Task Wolf cannot be asked.');
  }
  const tools = await client.listTools();
  const out = { workspace, serverInfo: client.getServerInfo?.() || null, tools: {} };
  const plan = [
    ['maintenance', TASK_WOLF_MAINTENANCE_TOOL, pickCustomerArguments, normalizeMaintenanceStatus],
    ['tasks', TASK_WOLF_TASKS_TOOL, pickTaskArguments, normalizeTasks],
  ];
  for (const [key, name, pick, normalize] of plan) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      out.tools[key] = { tool: name, offered: false };
      continue;
    }
    const picked = pick(tool.inputSchema || null, workspace);
    const entry = {
      tool: name,
      offered: true,
      inputSchema: tool.inputSchema || null,
      arguments: picked?.arguments || null,
    };
    if (!picked) {
      entry.error = 'No customer argument recognised in the schema.';
    } else {
      try {
        entry.raw = await client.callTool(name, picked.arguments);
        entry.normalized = normalize(entry.raw, now());
      } catch (error) {
        if (error.code === 'TW_AUTH') throw error;
        entry.error = error.message || String(error);
      }
    }
    out.tools[key] = entry;
  }
  out.summary = summarizeTaskWolfCustomer({
    maintenance: out.tools.maintenance?.normalized || null,
    tasks: out.tools.tasks?.normalized || null,
  });
  return out;
}

/** A customer row from the cached snapshot, for routes that take a workspace id. */
export function findCachedCustomer(workspaceId) {
  return state.snapshot?.customers?.find((c) => c.workspaceId === workspaceId) || null;
}

/**
 * Scan every workspace and build a fresh snapshot. Exported for the refresh
 * route and for tests, which inject their own client functions.
 */
export async function scanMaintenanceBacklog({
  client = { listWorkspaces, listOpenMaintenanceReports },
  taskWolfClient = defaultTaskWolfClient(),
  concurrency = getScanConcurrency(),
  taskWolfConcurrency = getTaskWolfConcurrency(),
  excludedSlugs = parseExcludedSlugs(process.env.MAINTENANCE_DASHBOARD_EXCLUDED_SLUGS),
  onProgress,
  now = Date.now,
} = {}) {
  const workspaces = await client.listWorkspaces();
  const total = workspaces.length;
  const progress = {
    phase: 'platform',
    scanned: 0,
    total,
    failed: 0,
    startedAt: new Date(now()).toISOString(),
  };
  if (onProgress) onProgress({ ...progress });

  const reportsByWorkspace = new Map();
  const errors = [];

  await mapWithConcurrency(
    workspaces,
    concurrency,
    (workspace) => client.listOpenMaintenanceReports(workspace.id),
    (result, index) => {
      const workspace = workspaces[index];
      if (result.error) {
        // An auth failure is not "this workspace has no backlog"; it is the
        // whole scan being blind. Surface it loudly instead of tallying it.
        if (result.error.code === 'QAW_AUTH') throw result.error;
        progress.failed += 1;
        errors.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          message: result.error.message || String(result.error),
        });
      } else {
        reportsByWorkspace.set(workspace.id, result.value || []);
      }
      progress.scanned += 1;
      if (onProgress) onProgress({ ...progress });
    },
  );

  const snapshot = buildSnapshot({
    workspaces,
    reportsByWorkspace,
    excludedSlugs,
    errors,
    now: now(),
  });

  if (!taskWolfClient) {
    return mergeTaskWolf(snapshot, new Map(), {
      enabled: false,
      error: {
        code: 'TW_CONFIG',
        message: 'TASK_WOLF_MCP_TOKEN is not set, so blocked status and QAE ownership are unknown.',
      },
    });
  }
  return enrichWithTaskWolf(snapshot, {
    client: taskWolfClient,
    concurrency: taskWolfConcurrency,
    onProgress,
    now,
  });
}

/** Kick a background rebuild unless one is already running. */
export function startRefresh(options = {}) {
  if (state.building) return state.building;
  state.lastError = null;
  state.progress = {
    phase: 'platform',
    scanned: 0,
    total: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
  };

  state.building = scanMaintenanceBacklog({
    ...options,
    onProgress: (progress) => {
      state.progress = progress;
    },
  })
    .then((snapshot) => {
      state.snapshot = snapshot;
      state.builtAt = Date.now();
      return snapshot;
    })
    .catch((error) => {
      console.error('Maintenance backlog scan failed:', error);
      state.lastError = { code: error.code || 'SCAN_FAILED', message: error.message };
      throw error;
    })
    .finally(() => {
      state.building = null;
      state.progress = null;
    });

  // Nobody has to await a background build; keep the rejection from surfacing
  // as an unhandled promise when the trigger was a fire-and-forget GET.
  state.building.catch(() => {});
  return state.building;
}

/**
 * What the page asks for. Answers straight from cache when it is fresh enough,
 * starts a rebuild otherwise, and never blocks on the scan itself.
 *
 * @param {{ refresh?: boolean }} [options]
 * @returns {{ status: 'ready'|'building'|'error', snapshot?: object, stale?: boolean, progress?: object, error?: object }}
 */
export function getMaintenanceDashboard({ refresh = false } = {}) {
  const now = Date.now();
  const isStale = !state.snapshot || now - state.builtAt > getCacheTtlMs();

  if (refresh || isStale) startRefresh();

  if (state.snapshot) {
    return {
      status: 'ready',
      snapshot: state.snapshot,
      builtAt: new Date(state.builtAt).toISOString(),
      stale: isStale,
      refreshing: Boolean(state.building),
      progress: state.progress,
      cacheTtlMinutes: Math.round(getCacheTtlMs() / 60000),
    };
  }

  if (state.building) {
    return { status: 'building', progress: state.progress };
  }

  return { status: 'error', error: state.lastError || { message: 'No snapshot available.' } };
}

/** Test hook: forget everything. */
export function resetMaintenanceCache() {
  state.snapshot = null;
  state.builtAt = 0;
  state.building = null;
  state.progress = null;
  state.lastError = null;
}
