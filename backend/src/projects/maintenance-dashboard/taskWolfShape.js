/**
 * Pure shaping for what Task Wolf adds to the Bone Pile.
 *
 * The platform API says which reports are open and how old they are. Task
 * Wolf says two things the platform cannot: whether the parked flows are
 * *blocked* (waiting on the customer -- an environment, a credential, a
 * decision -- which no SE can gnaw through) and whether a QAE already has a
 * maintenance task on that customer. Two curated MCP tools carry that:
 * `get_maintenance_status` (open maintenance + real blocked status) and
 * `find_tasks` (the task board by customer / type / status).
 *
 * Two facts shape the code here:
 *
 * 1. Task Wolf's customer `qawId` *is* the platform team id, which is the
 *    workspace id whoami hands us -- so no name matching is needed.
 * 2. The MCP's input schemas are read from the server at runtime
 *    (`tools/list`), not baked in. `pickArguments` fills whichever property
 *    names the schema actually declares, and the normalizers read the answer
 *    by tolerant key lookup, so a renamed field degrades to "unknown" rather
 *    than to a wrong number. `GET /api/maintenance-dashboard/taskwolf/customer/:id`
 *    shows the raw answer beside the normalized one for checking.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Task board statuses that mean the work is finished (Task Wolf: "all open
// statuses except done and ignore").
const CLOSED_TASK_STATUS_RE =
  /^(done|ignore[d]?|resolved|closed|complete[d]?|cancel+ed|archived)$/i;
const MAINTENANCE_TYPE_RE = /maint/i;

/* ---------- tolerant readers ---------- */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** First key on `obj` matching one of `names` (case-insensitive), by name order. */
function findKey(obj, names) {
  if (!isObject(obj)) return null;
  const keys = Object.keys(obj);
  for (const name of names) {
    const lower = name.toLowerCase();
    const hit = keys.find((k) => k.toLowerCase() === lower);
    if (hit) return hit;
  }
  return null;
}

function pick(obj, names) {
  const key = findKey(obj, names);
  return key === null ? undefined : obj[key];
}

function pickString(obj, names) {
  const value = pick(obj, names);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function pickNumber(obj, names) {
  const value = pick(obj, names);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function pickBoolean(obj, names) {
  const value = pick(obj, names);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|yes|y|1)$/i.test(value)) return true;
    if (/^(false|no|n|0)$/i.test(value)) return false;
  }
  return null;
}

/** A person-ish value: a string, or an object with a name/email/login. */
function pickPerson(obj, names) {
  const value = pick(obj, names);
  if (typeof value === 'string') return value.trim();
  if (isObject(value)) {
    return pickString(value, ['name', 'displayName', 'fullName', 'email', 'login', 'handle']) || '';
  }
  return '';
}

/** Whole days between an ISO/epoch timestamp and now; null when unparseable. */
export function daysSince(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / MS_PER_DAY));
}

/**
 * The list a tool answer carries. Task Wolf bounds lists as
 * `{ total, truncated, items }`; older/looser shapes put the array under a
 * descriptive key or nest it one level down. First array of objects wins,
 * preferred keys first.
 */
export function extractItems(raw, preferredKeys = [], depth = 0) {
  if (Array.isArray(raw)) return raw.filter(isObject);
  if (!isObject(raw) || depth > 2) return [];
  const keys = [...preferredKeys, 'items', 'results', 'rows', 'data', 'list'];
  for (const name of keys) {
    const value = pick(raw, [name]);
    if (Array.isArray(value)) return value.filter(isObject);
    if (isObject(value)) {
      const nested = extractItems(value, preferredKeys, depth + 1);
      if (nested.length) return nested;
    }
  }
  for (const value of Object.values(raw)) {
    if (Array.isArray(value) && value.some(isObject)) return value.filter(isObject);
  }
  for (const value of Object.values(raw)) {
    if (isObject(value)) {
      const nested = extractItems(value, preferredKeys, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

/* ---------- arguments from the live schema ---------- */

const ID_ARG_NAMES = [
  'qawId',
  'qaw_id',
  'teamId',
  'team_id',
  'workspaceId',
  'workspace_id',
  'customerId',
  'customer_id',
];
const NAME_ARG_NAMES = [
  'customer',
  'customerName',
  'customer_name',
  'customerSlug',
  'customer_slug',
  'slug',
  'query',
  'name',
  'team',
  'search',
];

/**
 * Build the `arguments` for a customer-scoped tool from its declared input
 * schema. Prefers an id-shaped property (exact match on the platform team id)
 * over a name-shaped one (resolved server-side by name/slug). Returns `null`
 * when the schema offers nothing recognisable, so the caller can report the
 * schema instead of guessing.
 *
 * @returns {{ arguments: object, via: string } | null}
 */
export function pickCustomerArguments(inputSchema, workspace) {
  const properties = isObject(inputSchema?.properties) ? inputSchema.properties : null;
  if (!properties) {
    // No schema published: the documented default is that customer names,
    // slugs or ids all resolve.
    return {
      arguments: { customer: workspace.slug || workspace.name || workspace.id },
      via: 'customer',
    };
  }
  const idKey = findKey(properties, ID_ARG_NAMES);
  if (idKey && workspace.id) return { arguments: { [idKey]: workspace.id }, via: idKey };
  const nameKey = findKey(properties, NAME_ARG_NAMES);
  if (nameKey) {
    const value = workspace.slug || workspace.name || workspace.id;
    return { arguments: { [nameKey]: value }, via: nameKey };
  }
  return null;
}

/** Enum value on a schema property matching `re`, if the property has an enum. */
function enumValueMatching(property, re) {
  const options = Array.isArray(property?.enum)
    ? property.enum
    : Array.isArray(property?.items?.enum)
      ? property.items.enum
      : null;
  if (!options) return undefined;
  return options.find((option) => typeof option === 'string' && re.test(option));
}

/**
 * Arguments for `find_tasks` scoped to one customer's open maintenance tasks,
 * again by reading the schema: the type filter is only set when the schema
 * declares one (using its own enum spelling when it has one), and closed
 * tasks are excluded either through a declared flag or later in
 * `normalizeTasks`, never by guessing a status name.
 */
export function pickTaskArguments(inputSchema, workspace) {
  const base = pickCustomerArguments(inputSchema, workspace);
  if (!base) return null;
  const properties = isObject(inputSchema?.properties) ? inputSchema.properties : {};
  const args = { ...base.arguments };

  const typeKey = findKey(properties, ['type', 'taskType', 'task_type', 'types', 'taskTypes']);
  if (typeKey) {
    const property = properties[typeKey];
    const value = enumValueMatching(property, MAINTENANCE_TYPE_RE) ?? 'maintenance';
    args[typeKey] = property?.type === 'array' ? [value] : value;
  }

  const openKey = findKey(properties, [
    'openOnly',
    'open_only',
    'onlyOpen',
    'excludeDone',
    'exclude_done',
  ]);
  if (openKey) args[openKey] = true;
  const includeDoneKey = findKey(properties, [
    'includeDone',
    'include_done',
    'includeClosed',
    'include_closed',
  ]);
  if (includeDoneKey) args[includeDoneKey] = false;

  const limitKey = findKey(properties, ['limit', 'pageSize', 'page_size', 'max', 'maxResults']);
  if (limitKey) {
    const max = Number(properties[limitKey]?.maximum);
    args[limitKey] = Number.isFinite(max) && max > 0 ? Math.min(200, max) : 200;
  }
  return { arguments: args, via: base.via };
}

/* ---------- normalizing answers ---------- */

const BLOCKER_KEYS = ['blocker', 'blockedBy', 'blocked_by', 'activeBlocker', 'blockers'];

function readBlocker(item) {
  const value = pick(item, BLOCKER_KEYS);
  const blocker = Array.isArray(value) ? value.find(isObject) || value[0] : value;
  if (!blocker) return null;
  if (typeof blocker === 'string') return { title: blocker, owner: '', ageDays: null };
  if (!isObject(blocker)) return null;
  return {
    title: pickString(blocker, ['title', 'name', 'reason', 'summary', 'description']) || 'Blocked',
    owner: pickPerson(blocker, ['owner', 'ownerName', 'assignee', 'assigneeName']),
    ageDays:
      pickNumber(blocker, ['ageDays', 'age_days', 'age', 'days']) ??
      daysSince(
        pick(blocker, ['createdAt', 'created_at', 'since', 'blockedSince', 'blocked_since']),
      ),
  };
}

/**
 * One maintenance entry (a flow parked out of the suite) as Task Wolf sees it.
 */
export function normalizeMaintenanceItem(item, now = Date.now()) {
  const blocker = readBlocker(item);
  const status = pickString(item, ['status', 'state', 'maintenanceStatus', 'maintenance_status']);
  const blockedFlag = pickBoolean(item, ['blocked', 'isBlocked', 'is_blocked']);
  const blocked = blockedFlag ?? (Boolean(blocker) || /blocked/i.test(status));
  const flow = pick(item, ['flow', 'workflow']);
  const ageDays =
    pickNumber(item, [
      'daysInMaintenance',
      'days_in_maintenance',
      'ageDays',
      'age_days',
      'age',
      'days',
    ]) ??
    daysSince(
      pick(item, [
        'maintenanceSince',
        'maintenance_since',
        'since',
        'startedAt',
        'started_at',
        'enteredAt',
        'entered_at',
        'createdAt',
        'created_at',
      ]),
      now,
    );
  return {
    flowId:
      pickString(item, ['flowId', 'flow_id', 'workflowId', 'workflow_id']) ||
      (isObject(flow) ? pickString(flow, ['id', 'flowId']) : '') ||
      pickString(item, ['id']),
    name:
      pickString(item, ['flowName', 'flow_name', 'name', 'title']) ||
      (isObject(flow) ? pickString(flow, ['name', 'title']) : ''),
    blocked,
    blockerTitle:
      blocker?.title ||
      (blocked ? pickString(item, ['blockReason', 'block_reason', 'reason']) : ''),
    blockerOwner: blocker?.owner || '',
    ageDays,
    assignee: pickPerson(item, [
      'assignee',
      'assigneeName',
      'assignee_name',
      'owner',
      'ownerName',
      'qae',
      'qaeName',
    ]),
    status,
    url: pickString(item, ['url', 'link', 'href', 'taskWolfUrl', 'task_wolf_url']),
  };
}

/**
 * `get_maintenance_status` -> counts plus the per-flow list when the server
 * sends one. Explicit summary numbers win over counting items, because a
 * bounded list may be truncated.
 */
export function normalizeMaintenanceStatus(raw, now = Date.now()) {
  const body = typeof raw === 'string' ? safeJson(raw) : raw;
  // Prose (or nothing) is "unknown", never "zero flows in maintenance".
  if (!isObject(body) && !Array.isArray(body)) return null;
  const source = isObject(body) ? body : { items: body };
  const summary = [
    source,
    pick(source, ['summary', 'counts', 'totals', 'maintenance', 'status']),
  ].filter(isObject);
  const items = extractItems(source, [
    'flows',
    'maintenanceFlows',
    'maintenance_flows',
    'flowsInMaintenance',
    'inMaintenance',
    'openMaintenance',
    'maintenance',
  ]).map((item) => normalizeMaintenanceItem(item, now));

  const readCount = (names) => {
    for (const obj of summary) {
      const value = pickNumber(obj, names);
      if (value !== null) return value;
    }
    return null;
  };

  const blockedFromItems = items.filter((i) => i.blocked).length;
  const total =
    readCount([
      'flowsInMaintenance',
      'flows_in_maintenance',
      'inMaintenance',
      'in_maintenance',
      'maintenanceCount',
      'maintenance_count',
      'openMaintenance',
      'open_maintenance',
      'totalInMaintenance',
      'total',
      'count',
    ]) ?? items.length;
  const blocked =
    readCount(['blocked', 'blockedFlows', 'blocked_flows', 'blockedCount', 'blocked_count']) ??
    blockedFromItems;
  const actionable =
    readCount([
      'actionable',
      'unblocked',
      'notBlocked',
      'not_blocked',
      'unblockedFlows',
      'unblocked_flows',
      'actionableFlows',
      'actionable_flows',
    ]) ?? Math.max(0, total - blocked);

  const blockers = new Map();
  for (const item of items) {
    if (!item.blocked) continue;
    const key = item.blockerTitle || 'Blocked';
    const entry = blockers.get(key) || { title: key, owner: item.blockerOwner, flows: 0 };
    entry.flows += 1;
    if (!entry.owner && item.blockerOwner) entry.owner = item.blockerOwner;
    blockers.set(key, entry);
  }

  return {
    flowsInMaintenance: total,
    blockedFlows: blocked,
    actionableFlows: actionable,
    truncated: pickBoolean(source, ['truncated']) ?? false,
    items,
    blockers: [...blockers.values()].sort((a, b) => b.flows - a.flows),
    url: pickString(source, ['url', 'link', 'taskWolfUrl', 'task_wolf_url', 'hqUrl', 'hq_url']),
  };
}

/** One task-board row. */
export function normalizeTask(item, now = Date.now()) {
  const status = pickString(item, ['status', 'state']);
  const blocker = readBlocker(item);
  const blockedFlag = pickBoolean(item, ['blocked', 'isBlocked', 'is_blocked']);
  const dueAt = pick(item, ['dueAt', 'due_at', 'dueDate', 'due_date', 'due']);
  const createdAt = pick(item, ['createdAt', 'created_at', 'created', 'openedAt']);
  const dueDays = daysSince(dueAt, now);
  return {
    id: pickString(item, ['id', 'taskId', 'task_id', 'key']),
    title: pickString(item, ['title', 'name', 'summary']),
    type: pickString(item, ['type', 'taskType', 'task_type', 'category']),
    status,
    open: !CLOSED_TASK_STATUS_RE.test(status || ''),
    blocked: blockedFlag ?? (Boolean(blocker) || /blocked/i.test(status)),
    blockerTitle: blocker?.title || '',
    assignee: pickPerson(item, [
      'assignee',
      'assigneeName',
      'assignee_name',
      'assignedTo',
      'assigned_to',
      'owner',
      'ownerName',
      'qae',
    ]),
    dueAt: typeof dueAt === 'string' ? dueAt : null,
    overdue: dueDays !== null && dueDays > 0,
    createdAt: typeof createdAt === 'string' ? createdAt : null,
    ageDays: pickNumber(item, ['ageDays', 'age_days', 'age']) ?? daysSince(createdAt, now),
    url: pickString(item, ['url', 'link', 'href', 'taskWolfUrl', 'task_wolf_url']),
  };
}

/**
 * `find_tasks` -> the open maintenance tasks for one customer. Closed and
 * non-maintenance rows are dropped here in case the server returned more than
 * the filter asked for (or the schema had no type filter to ask with).
 */
export function normalizeTasks(raw, now = Date.now()) {
  const body = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!isObject(body) && !Array.isArray(body)) return null;
  const items = extractItems(body, ['tasks']).map((item) => normalizeTask(item, now));
  const tasks = items.filter((t) => t.open && (!t.type || MAINTENANCE_TYPE_RE.test(t.type)));
  return {
    tasks,
    truncated: (isObject(body) && pickBoolean(body, ['truncated'])) || false,
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---------- per-customer roll-up + merge ---------- */

/**
 * Everything the page shows for one customer from Task Wolf, from the two
 * tool answers (either may be missing when that call failed).
 */
export function summarizeTaskWolfCustomer({ maintenance = null, tasks = null } = {}) {
  const taskRows = tasks?.tasks || [];
  const assignees = [...new Set(taskRows.map((t) => t.assignee).filter(Boolean))];
  const oldestTask = taskRows.reduce(
    (acc, t) => (t.ageDays !== null && (acc === null || t.ageDays > acc) ? t.ageDays : acc),
    null,
  );
  return {
    flowsInMaintenance: maintenance ? maintenance.flowsInMaintenance : null,
    blockedFlows: maintenance ? maintenance.blockedFlows : null,
    actionableFlows: maintenance ? maintenance.actionableFlows : null,
    blockers: maintenance ? maintenance.blockers : [],
    blockedFlowIds: maintenance
      ? maintenance.items.filter((i) => i.blocked && i.flowId).map((i) => i.flowId)
      : [],
    flowAssignees: maintenance
      ? Object.fromEntries(
          maintenance.items
            .filter((i) => i.flowId && i.assignee)
            .map((i) => [i.flowId, i.assignee]),
        )
      : {},
    openTasks: tasks ? taskRows.length : null,
    blockedTasks: tasks ? taskRows.filter((t) => t.blocked).length : null,
    overdueTasks: tasks ? taskRows.filter((t) => t.overdue).length : null,
    assignees,
    oldestTaskAgeDays: oldestTask,
    tasks: taskRows.slice(0, 25),
    truncated: Boolean(maintenance?.truncated || tasks?.truncated),
    url: maintenance?.url || taskRows.find((t) => t.url)?.url || '',
  };
}

/**
 * How a report reads once Task Wolf has spoken: how many of its parked flows
 * are blocked (when flow ids line up) and whether any of it is actionable.
 * `blocked` is a tri-state: true / false / null (Task Wolf said nothing that
 * can be tied to this report).
 */
export function annotateReport(report, customerTw) {
  if (!customerTw || customerTw.flowsInMaintenance === null) {
    return { ...report, taskWolf: null };
  }
  const blockedIds = new Set(customerTw.blockedFlowIds || []);
  const flowIds = report.flowIds || [];
  const matched = flowIds.filter((id) => blockedIds.has(id)).length;
  let blocked = null;
  if (flowIds.length > 0 && blockedIds.size > 0) blocked = matched === flowIds.length;
  else if (customerTw.blockedFlows === 0) blocked = false;
  else if (customerTw.actionableFlows === 0 && customerTw.flowsInMaintenance > 0) blocked = true;

  const assignees = new Set(customerTw.assignees || []);
  for (const id of flowIds) {
    const who = customerTw.flowAssignees?.[id];
    if (who) assignees.add(who);
  }
  return {
    ...report,
    taskWolf: {
      blocked,
      blockedFlows: matched,
      blockerTitle: blocked ? customerTw.blockers?.[0]?.title || 'Blocked' : '',
      assignees: [...assignees],
      openTasks: customerTw.openTasks,
    },
  };
}

/**
 * Fold the Task Wolf pass into a platform snapshot. Rows without Task Wolf
 * data keep `taskWolf: null`; totals count only what Task Wolf confirmed, so
 * "blocked" never grows from an absent answer.
 *
 * @param {object} snapshot            from buildSnapshot()
 * @param {Map<string, object>} byWorkspace  workspaceId -> summarizeTaskWolfCustomer()
 * @param {object} meta  { enabled, error, errors, customersQueried, startedAt, finishedAt }
 */
export function mergeTaskWolf(snapshot, byWorkspace, meta = {}) {
  const lookup = byWorkspace || new Map();
  const customers = snapshot.customers.map((c) => ({
    ...c,
    taskWolf: lookup.get(c.workspaceId) || null,
  }));
  const reports = snapshot.reports.map((r) => annotateReport(r, lookup.get(r.workspaceId)));

  const rows = customers.filter((c) => !c.isDemo && c.taskWolf);
  const reportRows = reports.filter((r) => !r.isDemo);
  const totals = {
    ...snapshot.totals,
    customersWithTaskWolf: rows.length,
    blockedFlows: rows.reduce((sum, c) => sum + (c.taskWolf.blockedFlows || 0), 0),
    actionableFlows: rows.reduce((sum, c) => sum + (c.taskWolf.actionableFlows || 0), 0),
    blockedReports: reportRows.filter((r) => r.taskWolf?.blocked === true).length,
    reportsWithQae: reportRows.filter((r) => r.taskWolf?.assignees?.length).length,
  };

  return {
    ...snapshot,
    totals,
    customers,
    reports,
    taskWolf: {
      enabled: Boolean(meta.enabled),
      error: meta.error || null,
      errors: meta.errors || [],
      customersQueried: meta.customersQueried ?? 0,
      customersAnswered: lookup.size,
      startedAt: meta.startedAt || null,
      finishedAt: meta.finishedAt || null,
      tools: meta.tools || null,
    },
  };
}
