/**
 * Builds and caches the maintenance backlog snapshot.
 *
 * One snapshot is about 2,000 `issue.find` calls (one per workspace the key
 * can see), which is minutes of fan-out, so the page never waits on a live scan:
 * a GET answers the cached snapshot, or a "building" status with progress
 * while the first scan runs in the background. A scan that fails on a few
 * workspaces still produces a snapshot -- the failures ride along in
 * `errors`, so the page can say "1,990 of 2,004 scanned" instead of showing
 * a number that is quietly short. A workspace with more open reports than one
 * scan reads rides along the same way, in `truncatedWorkspaces`.
 *
 * A scan that fails outright (no key, a rejected key, the workspace list unreachable or
 * listing no workspace with an id, or nothing but failures from the
 * workspaces) is remembered rather than
 * retried by the next GET: the page polls, so retrying on every request would
 * answer "building" forever and send upstream a doomed request every few
 * seconds. The error answers, with when it failed, until a short cool-down has
 * passed; a rescan asked for before then is refused, and the answer says when
 * one may start. It stands while the retry runs, so the page can say what is
 * being retried, and goes only when a scan publishes a snapshot; a retry that
 * fails too replaces it with its own.
 *
 * The Task Wolf pass comes second and can be slow, so the very first snapshot
 * is published before it starts, marked `taskWolf.pending`, and replaced when
 * the pass ends. The pass itself gives up on a Task Wolf that has stopped
 * answering rather than wait out every customer's timeout.
 *
 * The cache is per-process. Heroku restarts the dyno daily, so the first
 * request after a restart rebuilds it; that is acceptable for a page read a
 * few times a day, and it keeps this change free of schema migrations.
 */
import { listWorkspaces, listOpenMaintenanceReports } from './qawolfClient.js';
import {
  buildSnapshot,
  isExcludedWorkspace,
  parseExcludedSlugs,
  uniqueWorkspaces,
} from './maintenanceShape.js';
import {
  TaskWolfConfigError,
  getSharedTaskWolfClient,
  isTaskWolfConfigured,
} from './taskWolfMcpClient.js';
import {
  isCustomerNotFound,
  mergeTaskWolf,
  normalizeMaintenanceStatus,
  normalizeTasks,
  pickCustomerArguments,
  pickTaskArguments,
  summarizeTaskWolfCustomer,
} from './taskWolfShape.js';

const DEFAULT_TTL_MINUTES = 6 * 60;
const DEFAULT_RETRY_COOLDOWN_SECONDS = 60;
const DEFAULT_MIN_RESCAN_MINUTES = 15;
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 16;
const DEFAULT_TASK_WOLF_CONCURRENCY = 4;
const MAX_TASK_WOLF_CONCURRENCY = 8;
const DEFAULT_TASK_WOLF_MAX_CONSECUTIVE_FAILURES = 8;
const DEFAULT_TASK_WOLF_PASS_BUDGET_MINUTES = 15;

// When the first this-many workspaces to settle have all failed, the scan is
// looking at an outage, and the rest of the fan-out would only repeat it.
const SCAN_EARLY_FAILURE_LIMIT = 20;
// What a worker hands back for a workspace it skipped because the scan had stopped.
const NOT_ASKED = Symbol('not asked');

// How a Task Wolf that has stopped answering fails, as opposed to one that
// answered "not for this customer" (TW_TOOL) or answered nothing readable.
const TASK_WOLF_OUTAGE_CODES = new Set(['TW_NETWORK', 'TW_UPSTREAM', 'TW_FORBIDDEN']);

// What the page reads from a customer's Task Wolf roll-up. The scan needs the
// rest (listed and blocked flow ids, per-flow blockers and assignees, task
// rows) to annotate reports; nothing reads it afterwards, and it is most of
// the payload. A report's own `taskWolf` is small and goes out whole.
const PUBLISHED_CUSTOMER_TASK_WOLF_FIELDS = [
  'flowsInMaintenance',
  'blockedFlows',
  'actionableFlows',
  'partial',
  'assignees',
  'openTasks',
  'blockedTasks',
  'overdueTasks',
  'oldestTaskAgeDays',
  'blockers',
  'truncated',
  'url',
];

export const TASK_WOLF_MAINTENANCE_TOOL = 'get_maintenance_status';
export const TASK_WOLF_TASKS_TOOL = 'find_tasks';

const state = {
  snapshot: null, // last completed snapshot
  builtAt: 0, // Date.now() when it completed
  building: null, // in-flight promise, if any
  progress: null, // { scanned, total, startedAt, failed }
  lastError: null, // last whole-scan failure (auth, config, workspace list); a publish clears it
  failedAt: 0, // Date.now() when it failed
};

function readNumberEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getCacheTtlMs() {
  return readNumberEnv('MAINTENANCE_DASHBOARD_CACHE_TTL_MINUTES', DEFAULT_TTL_MINUTES) * 60 * 1000;
}

/**
 * How long a failed scan answers its error before another may start: the
 * retry a plain GET starts, or a rescan someone asked for (see nextRescanAt).
 */
export function getRetryCooldownMs() {
  return (
    readNumberEnv('MAINTENANCE_DASHBOARD_RETRY_COOLDOWN_SECONDS', DEFAULT_RETRY_COOLDOWN_SECONDS) *
    1000
  );
}

/**
 * How long after a scan succeeds before anyone may force another. A full scan
 * is about 2,000 QA Wolf calls, so Rescan, `?refresh=1` and `POST /refresh`
 * wait this out rather than stacking back-to-back scans.
 */
export function getMinRescanMs() {
  return (
    readNumberEnv('MAINTENANCE_DASHBOARD_MIN_RESCAN_MINUTES', DEFAULT_MIN_RESCAN_MINUTES) *
    60 *
    1000
  );
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

/** How many customers in a row Task Wolf may fail to answer before the pass stops. */
export function getTaskWolfMaxConsecutiveFailures() {
  return readNumberEnv(
    'TASK_WOLF_MAX_CONSECUTIVE_FAILURES',
    DEFAULT_TASK_WOLF_MAX_CONSECUTIVE_FAILURES,
  );
}

/** How long the Task Wolf pass may run before it stops with what it has. */
export function getTaskWolfPassBudgetMs() {
  return (
    readNumberEnv('TASK_WOLF_PASS_BUDGET_MINUTES', DEFAULT_TASK_WOLF_PASS_BUDGET_MINUTES) *
    60 *
    1000
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
 * the open maintenance tasks on the board. Either half may fail on its own.
 * An auth failure ends this customer's questions and comes back as
 * `authError`, beside whatever half had already answered, so the caller can
 * stop asking without losing it. `calls` counts the tool calls that went out,
 * so the caller can tell "every call failed" from "one half is missing".
 * A tool that answers it has no such customer is not a failure: it goes in
 * `notFound`, not in `errors`, with the argument it was sent.
 */
async function queryTaskWolfCustomer(client, schemas, customer, now) {
  const workspace = { id: customer.workspaceId, slug: customer.slug, name: customer.name };
  const result = {
    maintenance: null,
    tasks: null,
    errors: [],
    notFound: [],
    calls: 0,
    authError: null,
  };

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
    result.calls += 1;
    try {
      const normalized = attempt.apply(await client.callTool(attempt.tool, picked.arguments));
      if (normalized === null) {
        // Prose, or JSON with no count and no items in it.
        result.errors.push({
          tool: attempt.tool,
          message: `${attempt.tool} gave an answer with no readable maintenance data, so it was not counted.`,
        });
      }
    } catch (error) {
      // "No customer matched": a former customer, most often. Task Wolf
      // answered; it just has nothing on this one.
      if (isCustomerNotFound(error)) {
        result.notFound.push({
          tool: attempt.tool,
          via: picked.via,
          value: picked.arguments[picked.via],
        });
        continue;
      }
      result.errors.push({
        tool: attempt.tool,
        code: error.code || null,
        message: error.message || String(error),
      });
      // Only a dead token (401) says something about every call after it. A
      // 403 is this customer's failure, like a timeout or a 500.
      if (error.code === 'TW_AUTH') {
        result.authError = error;
        break;
      }
    }
  }
  return result;
}

/** Every tool call made for this customer failed the way an outage fails. */
function isTaskWolfOutage(answer) {
  const failed = answer.errors.filter((e) => TASK_WOLF_OUTAGE_CODES.has(e.code));
  return answer.calls > 0 && failed.length === answer.calls;
}

/**
 * The tools a `tools/list` answer offers, by name. Entries that are not tool
 * objects are skipped, so one bad row cannot take the platform scan down.
 */
function findToolIn(tools, name) {
  const catalog = Array.isArray(tools) ? tools.filter((t) => t && typeof t === 'object') : [];
  return catalog.find((t) => t.name === name);
}

/**
 * Second pass: fold Task Wolf's view (blocked vs actionable, who is on it)
 * into a platform snapshot. Only customers with backlog are asked, demos
 * skipped, so this is a few hundred calls rather than about 2,000. Never throws:
 * a missing token, an expired token or a server-side failure lands in
 * `snapshot.taskWolf.error` and the page says so beside the platform data,
 * which is still right.
 *
 * A Task Wolf that accepts requests and then answers none of them would cost
 * a full timeout per call, so the pass stops asking (`TW_ABORTED`) after
 * `maxConsecutiveFailures` customers in a row got nothing but outage-shaped
 * failures, or once it has run longer than `budgetMs`. An expired token
 * stops it the same way at the first 401, under `TW_AUTH`. Either way,
 * customers already asked are still heard out and recorded; only those never
 * asked are skipped. A pass that ran to its end and got an answer for no
 * customer at all is reported under `TW_ABORTED`.
 *
 * A customer Task Wolf has no record of ("No customer matched", a former
 * customer most often) is none of the above: it is counted in
 * `customersNotInTaskWolf`, not listed in `errors`, and its reports stay
 * unknown. A customer one tool knows is answered by that tool. A pass in
 * which Task Wolf had no record of any customer asked (more than one) is
 * the exception: that is a customer argument it no longer takes, not every
 * customer a former one, and it is reported under `TW_ABORTED`.
 */
export async function enrichWithTaskWolf(
  snapshot,
  {
    client,
    concurrency = getTaskWolfConcurrency(),
    maxConsecutiveFailures = getTaskWolfMaxConsecutiveFailures(),
    budgetMs = getTaskWolfPassBudgetMs(),
    onProgress,
    now = Date.now,
  } = {},
) {
  const targets = snapshot.customers.filter((c) => !c.isDemo);
  const startedAt = now();
  const meta = {
    enabled: true,
    errors: [],
    customersQueried: targets.length,
    customersNotInTaskWolf: 0,
    startedAt: new Date(startedAt).toISOString(),
    tools: null,
  };
  const byWorkspace = new Map();

  const finish = () => {
    meta.finishedAt = new Date(now()).toISOString();
    const merged = mergeTaskWolf(snapshot, byWorkspace, meta);
    // The merge keeps the pass fields it knows of; this one is the pass's own.
    return {
      ...merged,
      taskWolf: { ...merged.taskWolf, customersNotInTaskWolf: meta.customersNotInTaskWolf },
    };
  };

  let tools;
  try {
    tools = await client.listTools();
  } catch (error) {
    meta.error = { code: error.code || 'TW_UPSTREAM', message: error.message };
    return finish();
  }
  const findSchema = (name) => {
    const tool = findToolIn(tools, name);
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

  let failedInARow = 0;
  let asked = 0;
  // The first customer Task Wolf had no record of, and what it was sent.
  let firstNotFound = null;
  // Why the pass stopped asking, once it has: an expired token (TW_AUTH), or
  // the cut-off or the budget (TW_ABORTED). Calls already out cannot be taken
  // back, so their answers are still recorded when they come in.
  let stopped = null;

  try {
    await mapWithConcurrency(
      targets,
      concurrency,
      (customer) => {
        if (stopped) return null;
        asked += 1;
        return queryTaskWolfCustomer(client, schemas, customer, now());
      },
      (result, index) => {
        if (result.value === null) return; // never asked: the pass had stopped
        const customer = targets[index];
        let outage = false;
        if (result.error) {
          outage = TASK_WOLF_OUTAGE_CODES.has(result.error.code);
          progress.failed += 1;
          meta.errors.push({
            workspaceId: customer.workspaceId,
            workspaceName: customer.name,
            message: result.error.message || String(result.error),
          });
        } else {
          const answer = result.value;
          // A dead token stops the pass, whatever stopped it before. What this
          // customer answered before the 401 is kept like any half answer.
          if (answer.authError) {
            stopped = { code: 'TW_AUTH', message: answer.authError.message };
          }
          outage = isTaskWolfOutage(answer);
          if (answer.maintenance || answer.tasks) {
            byWorkspace.set(customer.workspaceId, summarizeTaskWolfCustomer(answer));
          } else if (answer.notFound.length) {
            meta.customersNotInTaskWolf += 1;
            if (!firstNotFound) firstNotFound = { customer, ...answer.notFound[0] };
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

        // Nothing to cut short once every customer has been asked.
        const left = targets.length - asked;
        if (stopped || left === 0) return;
        failedInARow = outage ? failedInARow + 1 : 0;
        if (failedInARow >= maxConsecutiveFailures) {
          stopped = {
            code: 'TW_ABORTED',
            message: `Task Wolf failed to answer for ${failedInARow} customers in a row, so the pass stopped with ${left} of ${targets.length} customers left. Last failure: ${meta.errors.at(-1).message}`,
          };
        } else if (now() - startedAt > budgetMs) {
          stopped = {
            code: 'TW_ABORTED',
            message: `The Task Wolf pass ran past its ${Math.round(budgetMs / 60000)}-minute budget, so it stopped with ${left} of ${targets.length} customers left.`,
          };
        }
      },
    );
  } catch (error) {
    // Nothing above throws on purpose; if something does, keep what was
    // gathered and say why the rest is missing.
    meta.error = { code: error.code || 'TW_UPSTREAM', message: error.message };
  }
  if (stopped && !meta.error) meta.error = stopped;
  // The cut-off never fires once every customer has been asked, so a pass can
  // run to its end without one answer. That is not a clean pass with some errors.
  // A customer Task Wolf has no record of had nothing to answer, so it is left out.
  const notInTaskWolf = meta.customersNotInTaskWolf;
  const others = progress.scanned - notInTaskWolf;
  if (!meta.error && others > 0 && byWorkspace.size === 0) {
    const [first] = meta.errors;
    let count =
      others === 1
        ? 'Task Wolf did not answer for the one customer asked.'
        : `Task Wolf answered for none of the ${others} customers asked.`;
    if (notInTaskWolf > 0) {
      count = `Of the ${progress.scanned} customers asked, Task Wolf has no record of ${notInTaskWolf} and ${
        others === 1
          ? 'did not answer for the other one'
          : `answered for none of the other ${others}`
      }.`;
    }
    const firstFailure = first
      ? ` First failure (${first.workspaceName || first.workspaceId}): ${first.message}`
      : '';
    meta.error = { code: 'TW_ABORTED', message: `${count}${firstFailure}` };
  }
  // Some former customers are expected; Task Wolf knowing none of those asked
  // is what a customer argument it no longer takes looks like. One customer on
  // its own may well be a former one.
  if (!meta.error && others === 0 && notInTaskWolf > 1) {
    const { customer, tool, via, value } = firstNotFound;
    meta.error = {
      code: 'TW_ABORTED',
      message: `Task Wolf has no record of any of the ${notInTaskWolf} customers asked, so the customer argument it is sent is probably wrong. First (${
        customer.name || customer.workspaceId
      }): ${tool} was sent ${via} ${JSON.stringify(value)}.`,
    };
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
    const tool = findToolIn(tools, name);
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
 * A scan that got nothing but failures is an outage, not an empty backlog, so
 * it fails as a whole: under the code the failures share when they share one,
 * naming how many failed and the first of them.
 */
function scanFailedError(errors, codes, total) {
  const [first] = errors;
  const [code] = codes;
  const stoppedEarly = errors.length < total;
  let count = `All ${total} workspaces scanned failed.`;
  if (stoppedEarly) {
    count = `The first ${errors.length} of ${total} workspaces scanned all failed, so the scan was stopped.`;
  } else if (total === 1) {
    count = 'The one workspace scanned failed.';
  }
  const error = new Error(
    `${count} First failure (${first.workspaceName || first.workspaceId}): ${first.message}`,
  );
  error.code = codes.size === 1 && code ? code : 'QAW_UPSTREAM';
  return error;
}

/** QA Wolf listed workspaces and none of them carried an id to scan by. */
function workspacesWithoutIdsError(workspaces) {
  const count =
    workspaces.length === 1
      ? 'listed 1 workspace and it had no id'
      : `listed ${workspaces.length} workspaces and none had an id`;
  const keys = Object.keys(workspaces.find((w) => w && typeof w === 'object') || {});
  const error = new Error(
    `QA Wolf ${count}, so there was nothing to scan.${
      keys.length ? ` Keys of the first: ${keys.join(', ')}` : ''
    }`,
  );
  error.code = 'QAW_UPSTREAM';
  return error;
}

/**
 * The platform snapshot as it goes out while Task Wolf is still being asked:
 * every row unknown to Task Wolf, and `pending` so the page can say why.
 */
function withTaskWolfPending(snapshot, now) {
  const merged = mergeTaskWolf(snapshot, new Map(), {
    enabled: true,
    customersQueried: snapshot.customers.filter((c) => !c.isDemo).length,
    startedAt: new Date(now).toISOString(),
  });
  return { ...merged, taskWolf: { ...merged.taskWolf, pending: true } };
}

/**
 * Scan every workspace and build a fresh snapshot. Exported for the refresh
 * route and for tests, which inject their own client functions.
 *
 * Excluded workspaces are not asked at all, and a workspace QA Wolf lists twice
 * is asked once. A workspace whose report list the client cut short is not a
 * failure: its reports count, and the snapshot marks them as a floor.
 * `onPlatformSnapshot` is handed the platform-only snapshot, marked
 * `taskWolf.pending`, just before the Task Wolf pass starts.
 */
export async function scanMaintenanceBacklog({
  client = { listWorkspaces, listOpenMaintenanceReports },
  taskWolfClient = defaultTaskWolfClient(),
  concurrency = getScanConcurrency(),
  taskWolfConcurrency = getTaskWolfConcurrency(),
  excludedSlugs = parseExcludedSlugs(process.env.MAINTENANCE_DASHBOARD_EXCLUDED_SLUGS),
  onProgress,
  onPlatformSnapshot,
  now = Date.now,
} = {}) {
  const workspaces = await client.listWorkspaces();
  const listed = uniqueWorkspaces(workspaces);
  if (workspaces?.length > 0 && listed.length === 0) {
    // A renamed id field or wrapped entries, not a key that sees nothing: an
    // empty backlog here would replace a good snapshot with a wrong one.
    throw workspacesWithoutIdsError(workspaces);
  }
  const toScan = listed.filter((workspace) => !isExcludedWorkspace(workspace, excludedSlugs));
  const total = toScan.length;
  const progress = {
    phase: 'platform',
    scanned: 0,
    total,
    failed: 0,
    startedAt: new Date(now()).toISOString(),
  };
  if (onProgress) onProgress({ ...progress });

  const reportsByWorkspace = new Map();
  const truncatedWorkspaceIds = new Set();
  const errors = [];
  const errorCodes = new Set();
  // Set once the first workspaces to settle have all failed. Nobody else is
  // asked, but the ones already out are heard: a dead key among them is what
  // the scan failed of.
  let stopped = null;

  await mapWithConcurrency(
    toScan,
    concurrency,
    (workspace) => (stopped ? NOT_ASKED : client.listOpenMaintenanceReports(workspace.id)),
    (result, index) => {
      if (result.value === NOT_ASKED) return;
      const workspace = toScan[index];
      // An auth failure is not "this workspace has no backlog"; it is the
      // whole scan being blind. Surface it loudly instead of tallying it.
      if (result.error?.code === 'QAW_AUTH') throw result.error;
      if (stopped) return;
      if (result.error) {
        progress.failed += 1;
        errorCodes.add(result.error.code || null);
        errors.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          message: result.error.message || String(result.error),
        });
      } else {
        reportsByWorkspace.set(workspace.id, result.value.issues);
        if (result.value.truncated) truncatedWorkspaceIds.add(workspace.id);
      }
      progress.scanned += 1;
      if (onProgress) onProgress({ ...progress });
      if (progress.scanned === SCAN_EARLY_FAILURE_LIMIT && progress.failed === progress.scanned) {
        stopped = scanFailedError(errors, errorCodes, total);
      }
    },
  );

  if (stopped) throw stopped;
  if (errors.length > 0 && errors.length === total) {
    throw scanFailedError(errors, errorCodes, total);
  }

  const snapshot = buildSnapshot({
    workspaces,
    reportsByWorkspace,
    truncatedWorkspaceIds,
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
  if (onPlatformSnapshot) onPlatformSnapshot(withTaskWolfPending(snapshot, now()));
  return enrichWithTaskWolf(snapshot, {
    client: taskWolfClient,
    concurrency: taskWolfConcurrency,
    onProgress,
    now,
  });
}

/**
 * What goes into the cache, and so into every response: the snapshot with
 * each customer's Task Wolf roll-up cut down to the fields the page reads.
 */
function publishedSnapshot(snapshot) {
  return {
    ...snapshot,
    customers: snapshot.customers.map((customer) =>
      customer.taskWolf
        ? {
            ...customer,
            taskWolf: Object.fromEntries(
              PUBLISHED_CUSTOMER_TASK_WOLF_FIELDS.filter((key) => key in customer.taskWolf).map(
                (key) => [key, customer.taskWolf[key]],
              ),
            ),
          }
        : customer,
    ),
    // Only a pass that ran counts customers Task Wolf has no record of; one
    // still pending or not connected has found none yet.
    taskWolf: {
      ...snapshot.taskWolf,
      pending: Boolean(snapshot.taskWolf?.pending),
      customersNotInTaskWolf: snapshot.taskWolf?.customersNotInTaskWolf ?? 0,
    },
  };
}

/**
 * Put a snapshot in the cache. Every whole-scan failure happens before the
 * platform snapshot exists, so a scan that has one to publish, interim or
 * final, has got past what the last failed scan could not, and its failure goes.
 */
function publish(snapshot) {
  state.snapshot = publishedSnapshot(snapshot);
  state.builtAt = Date.now();
  state.lastError = null;
  state.failedAt = 0;
}

/**
 * Kick a background rebuild unless one is already running. The last failure,
 * if any, stays until this scan publishes a snapshot or fails in its turn.
 */
export function startRefresh(options = {}) {
  if (state.building) return state.building;
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
    // First scan only: the backlog goes on the page while Task Wolf is asked.
    // A snapshot already there stays until the new one is complete, and so
    // does the failure beside it.
    onPlatformSnapshot: (interim) => {
      if (state.snapshot) return;
      publish(interim);
    },
  })
    .then((snapshot) => {
      publish(snapshot);
      return state.snapshot;
    })
    .catch((error) => {
      console.error('Maintenance backlog scan failed:', error);
      // A retry that failed too replaces the failure it was retrying.
      state.lastError = { code: error.code || 'SCAN_FAILED', message: error.message };
      state.failedAt = Date.now();
      if (state.snapshot?.taskWolf?.pending) {
        // The scan broke after its interim snapshot went out. The platform
        // rows stand; Task Wolf is no longer being asked.
        state.snapshot = {
          ...state.snapshot,
          taskWolf: { ...state.snapshot.taskWolf, pending: false, error: state.lastError },
        };
      }
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
 * When a forced rescan may next start, as a Date.now() value: the minimum gap
 * after the last snapshot, and the retry cool-down after a failed scan that no
 * snapshot has come since. At or before now means it may start now.
 */
function nextRescanAt() {
  return Math.max(
    state.snapshot ? state.builtAt + getMinRescanMs() : 0,
    state.failedAt ? state.failedAt + getRetryCooldownMs() : 0,
  );
}

/** `rescanAvailableAt` for a response: null when a rescan may start now. */
function rescanAvailableAt(now) {
  const at = nextRescanAt();
  return at > now ? new Date(at).toISOString() : null;
}

/**
 * A rescan someone asked for (Rescan, `?refresh=1`, `POST /refresh`). A scan
 * in flight is joined, never repeated; otherwise one starts only once the gap
 * since the last scan has passed.
 *
 * @returns {{ accepted: boolean, retryAfterMs: number }}
 */
export function requestRescan(now = Date.now()) {
  if (state.building) return { accepted: true, retryAfterMs: 0 };
  const at = nextRescanAt();
  if (at > now) return { accepted: false, retryAfterMs: at - now };
  startRefresh();
  return { accepted: true, retryAfterMs: 0 };
}

/**
 * The last failure as an answer carries it, with when it failed, or null
 * while none stands: in `refreshError`, or as the `error` itself when there is
 * no snapshot and no scan running.
 */
function failureAnswer() {
  return state.lastError
    ? { ...state.lastError, failedAt: new Date(state.failedAt).toISOString() }
    : null;
}

/**
 * What the page asks for. Answers straight from cache when it is fresh enough,
 * starts a rebuild otherwise, and never blocks on the scan itself. A rebuild
 * that failed is not restarted until the cool-down passes, and `refresh` goes
 * through `requestRescan`, so it waits out the same gaps. With no snapshot
 * the failure is the answer, beside `rescanAvailableAt`, so a rescan refused
 * inside the cool-down still says when one may start; with one it rides along
 * as `refreshError` beside the stale snapshot. While a retry runs it stays in
 * `refreshError`, beside the snapshot or beside `building` when there is none,
 * until a scan publishes a snapshot.
 *
 * @param {{ refresh?: boolean }} [options]
 * @returns {{ status: 'ready'|'building'|'error', snapshot?: object, stale?: boolean, progress?: object, refreshError?: object|null, rescanAvailableAt?: string|null, error?: object }}
 */
export function getMaintenanceDashboard({ refresh = false } = {}) {
  const now = Date.now();
  const isStale = !state.snapshot || now - state.builtAt > getCacheTtlMs();
  const coolingDown = Boolean(state.lastError) && now - state.failedAt < getRetryCooldownMs();

  if (refresh) requestRescan(now);
  else if (isStale && !coolingDown) startRefresh();

  if (state.snapshot) {
    return {
      status: 'ready',
      snapshot: state.snapshot,
      builtAt: new Date(state.builtAt).toISOString(),
      stale: isStale,
      refreshing: Boolean(state.building),
      progress: state.progress,
      refreshError: failureAnswer(),
      rescanAvailableAt: rescanAvailableAt(now),
      cacheTtlMinutes: Math.round(getCacheTtlMs() / 60000),
    };
  }

  // Checked before the failure: a first scan being retried is building.
  if (state.building) {
    return { status: 'building', progress: state.progress, refreshError: failureAnswer() };
  }

  return {
    status: 'error',
    error: failureAnswer() || { message: 'No snapshot available.' },
    rescanAvailableAt: rescanAvailableAt(now),
  };
}

/**
 * What the page polls while a scan runs: where things stand, without the
 * snapshot, so a poll costs a few hundred bytes rather than the whole backlog.
 * It reads the state and changes nothing; in particular it never starts a
 * scan. `builtAt` moves whenever a snapshot is published, which is the cue to
 * fetch the full payload. With nothing cached, nothing running and nothing
 * failed (a process nobody has asked yet) it answers `error` / `NO_SNAPSHOT`.
 * A failure that still stands is `refreshError` beside `ready`, or beside
 * `building` while a first scan is retried, as in `getMaintenanceDashboard`;
 * with neither, it is `error`, with when it failed.
 *
 * @returns {{ status: 'ready'|'building'|'error', builtAt: string|null, stale: boolean, refreshing: boolean, progress: object|null, refreshError: object|null, rescanAvailableAt: string|null, error: { code: string, message: string, failedAt?: string }|null }}
 */
export function getMaintenanceStatus() {
  const refreshing = Boolean(state.building);
  const answer = {
    status: 'error',
    builtAt: null,
    stale: false,
    refreshing,
    progress: state.progress,
    refreshError: null,
    rescanAvailableAt: rescanAvailableAt(Date.now()),
    error: null,
  };

  if (state.snapshot) {
    answer.status = 'ready';
    answer.builtAt = new Date(state.builtAt).toISOString();
    answer.stale = Date.now() - state.builtAt > getCacheTtlMs();
    answer.refreshError = failureAnswer();
  } else if (refreshing) {
    answer.status = 'building';
    answer.refreshError = failureAnswer();
  } else {
    answer.error = failureAnswer() || { code: 'NO_SNAPSHOT', message: 'No snapshot available.' };
  }
  return answer;
}

/** Test hook: forget everything. */
export function resetMaintenanceCache() {
  state.snapshot = null;
  state.builtAt = 0;
  state.building = null;
  state.progress = null;
  state.lastError = null;
  state.failedAt = 0;
}
