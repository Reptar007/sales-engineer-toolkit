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
 *    workspace id QA Wolf lists -- so no name matching is needed.
 * 2. The arguments each tool is sent are fixed, as Task Wolf's schemas
 *    declare them; a tool whose published schema (`tools/list`) no longer
 *    declares one is reported rather than asked (`schemaDrift`). The
 *    normalizers read the answer by tolerant key lookup, so a renamed field
 *    degrades to "unknown" rather than to a wrong number.
 *    `GET /api/maintenance-dashboard/taskwolf/customer/:id` shows the raw
 *    answer beside the normalized one for checking.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// An epoch number below this is in seconds: as milliseconds it would be a
// date before March 1973, as seconds it reaches the year 5138.
const EPOCH_SECONDS_BELOW = 1e11;

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

function isNamed(names, key) {
  return names.some((name) => name.toLowerCase() === key.toLowerCase());
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
  if (value === 1) return true;
  if (value === 0) return false;
  if (typeof value === 'string') {
    if (/^(true|yes|y|1)$/i.test(value.trim())) return true;
    if (/^(false|no|n|0)$/i.test(value.trim())) return false;
  }
  return null;
}

/** Nothing in it: null, '', or an object/array holding only such values. */
function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every(isBlank);
  if (isObject(value)) return Object.values(value).every(isBlank);
  return false;
}

/** A person-ish value: a string, or an object with a name/email/login. */
function personName(value) {
  if (typeof value === 'string') return value.trim();
  if (isObject(value)) {
    return pickString(value, ['name', 'displayName', 'fullName', 'email', 'login', 'handle']) || '';
  }
  return '';
}

function pickPerson(obj, names) {
  return personName(pick(obj, names));
}

/** Every person named under the first key found: a list of them, or just one. */
function pickPeople(obj, names) {
  const value = pick(obj, names);
  const people = (Array.isArray(value) ? value : [value]).map(personName).filter(Boolean);
  return [...new Set(people)];
}

/**
 * Whole days between an ISO/epoch timestamp and now; null when unparseable.
 * An epoch number may be in seconds or in milliseconds.
 */
export function daysSince(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  let parsed = typeof value === 'number' ? value : Date.parse(value);
  if (typeof value === 'number' && value < EPOCH_SECONDS_BELOW) parsed = value * 1000;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / MS_PER_DAY));
}

const LIST_KEYS = ['items', 'results', 'rows', 'data', 'list'];
// What went wrong, not what was asked for: `{ errors: [{ message }] }` is no
// list of flows or tasks, however many objects it holds.
const ERROR_KEYS = ['error', 'errors', 'details', 'warnings', 'messages', 'problems'];
const TRUNCATED_KEYS = ['truncated', 'hasMore', 'has_more'];

/**
 * The list a tool answer carries and the object it sits in (null for a bare
 * array), or null when there is none. Task Wolf bounds lists as
 * `{ total, truncated, items }`; older/looser shapes put the array under a
 * descriptive key or nest it one level down. First array of objects wins,
 * preferred keys first; nothing under an error-ish key is taken.
 */
function findList(raw, preferredKeys = [], depth = 0) {
  if (Array.isArray(raw)) return { items: raw.filter(isObject), holder: null };
  if (!isObject(raw) || depth > 2) return null;
  const keys = [...preferredKeys, ...LIST_KEYS];
  // A nested list of nothing still says where the list was, and what bounds it.
  let empty = null;
  const inside = (value) => {
    const nested = findList(value, preferredKeys, depth + 1);
    if (!nested?.items.length) empty = empty || nested;
    return nested?.items.length ? nested : null;
  };
  for (const name of keys) {
    const value = pick(raw, [name]);
    if (Array.isArray(value)) return { items: value.filter(isObject), holder: raw };
    if (isObject(value)) {
      const nested = inside(value);
      if (nested) return nested;
    }
  }
  const values = Object.entries(raw)
    .filter(([key]) => !isNamed(ERROR_KEYS, key))
    .map(([, value]) => value);
  for (const value of values) {
    if (Array.isArray(value) && value.some(isObject)) {
      return { items: value.filter(isObject), holder: raw };
    }
  }
  for (const value of values) {
    if (isObject(value)) {
      const nested = inside(value);
      if (nested) return nested;
    }
  }
  return empty;
}

/** The list a tool answer carries (see `findList`); [] when there is none. */
export function extractItems(raw, preferredKeys = []) {
  return findList(raw, preferredKeys)?.items || [];
}

/**
 * Whether an answer carries a list at all, where `extractItems` looks: an
 * empty `items` is a list of nothing, `{ message: 'No customer matched' }`
 * and `{ errors: [{ message }] }` are no list.
 */
function carriesList(raw, preferredKeys = [], depth = 0) {
  if (Array.isArray(raw)) return true;
  if (!isObject(raw) || depth > 2) return false;
  const keys = [...preferredKeys, ...LIST_KEYS];
  return Object.entries(raw).some(([key, value]) => {
    if (isNamed(ERROR_KEYS, key)) return false;
    return Array.isArray(value)
      ? isNamed(keys, key) || value.some(isObject)
      : carriesList(value, preferredKeys, depth + 1);
  });
}

/**
 * Whether the server flagged a bounded list as cut short (`truncated`,
 * `hasMore`), on the top of the answer or on the object the list sits in.
 */
function flaggedCutShort(objects) {
  return objects.some((obj) => pickBoolean(obj, TRUNCATED_KEYS) === true);
}

/* ---------- the arguments each tool is sent ---------- */

/**
 * `get_maintenance_status` for one customer. Its `customer` takes a name, a
 * slug or a qawId, and the workspace id is the qawId: the one value Task Wolf
 * matches exactly.
 */
export function maintenanceStatusArguments(workspaceId) {
  return { customer: workspaceId };
}

/**
 * `find_tasks` for one customer's maintenance tasks, the customer as above.
 * No `statuses` is sent, so Task Wolf's default (open tasks) applies;
 * `normalizeTasks` drops closed and other-type rows all the same.
 */
export function maintenanceTaskArguments(workspaceId) {
  return { customer: workspaceId, types: ['testMaintenance'] };
}

/**
 * Why a tool would refuse the arguments above, going by the schema it
 * publishes: the ones it no longer declares, beside the properties it does.
 * Null when it declares them all, or publishes no properties to check. The
 * caller reports this instead of asking. Names are matched exactly, not by the
 * tolerant lookup the answers get: a server that declares `Customer` would
 * refuse `customer`.
 */
export function schemaDrift(tool, inputSchema, args) {
  const properties = inputSchema?.properties;
  if (!isObject(properties)) return null;
  const missing = Object.keys(args).filter((key) => !Object.hasOwn(properties, key));
  if (missing.length === 0) return null;
  const declared = Object.keys(properties).join(', ') || 'no properties';
  return `No ${missing.join(' or ')} argument in the ${tool} schema (${declared}).`;
}

/* ---------- normalizing answers ---------- */

const BLOCKER_KEYS = ['blocker', 'blockedBy', 'blocked_by', 'activeBlocker', 'blockers'];
const BLOCKED_FLAG_KEYS = ['blocked', 'isBlocked', 'is_blocked'];

// "blocked" as a word of its own ("Blocked", "blocked_on_customer",
// "customer-blocked") unless it is negated ("not_blocked", "non-blocked").
// "unblocked" never matches: its "blocked" is not a word of its own.
const BLOCKED_WORD_RE = /(^|[^a-z])blocked([^a-z]|$)/;
const NEGATED_BLOCKED_RE = /(^|[^a-z])(not|non|no|un)[^a-z]*blocked/;

function statusSaysBlocked(status) {
  const words = status.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return BLOCKED_WORD_RE.test(words) && !NEGATED_BLOCKED_RE.test(words);
}

function isResolvedBlocker(blocker) {
  if (pickBoolean(blocker, ['resolved', 'isResolved', 'is_resolved', 'closed', 'cleared'])) {
    return true;
  }
  if (pickBoolean(blocker, ['active', 'isActive', 'is_active', 'open']) === false) return true;
  const resolvedAt = pick(blocker, [
    'resolvedAt',
    'resolved_at',
    'closedAt',
    'closed_at',
    'clearedAt',
    'cleared_at',
  ]);
  if (!isBlank(resolvedAt)) return true;
  return CLOSED_TASK_STATUS_RE.test(pickString(blocker, ['status', 'state']));
}

/** A blocker still in the way: it says something, and is not marked resolved. */
function isActiveBlocker(blocker) {
  if (typeof blocker === 'string') return blocker.trim() !== '';
  if (!isObject(blocker) || isBlank(blocker)) return false;
  return !isResolvedBlocker(blocker);
}

function readBlocker(item) {
  const value = pick(item, BLOCKER_KEYS);
  const blocker = (Array.isArray(value) ? value : [value]).find(isActiveBlocker);
  if (!blocker) return null;
  if (typeof blocker === 'string') return { title: blocker.trim(), owner: '', ageDays: null };
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
 * Whether an entry is blocked: an explicit flag (true/false, 1/0) wins, then
 * an active blocker, then a status that says so in words.
 */
function readBlocked(item, blocker, status) {
  const flag = pickBoolean(item, BLOCKED_FLAG_KEYS);
  return flag ?? (Boolean(blocker) || statusSaysBlocked(status));
}

/**
 * One maintenance entry (a flow parked out of the suite) as Task Wolf sees it.
 */
export function normalizeMaintenanceItem(item, now = Date.now()) {
  const blocker = readBlocker(item);
  const status = pickString(item, ['status', 'state', 'maintenanceStatus', 'maintenance_status']);
  const blocked = readBlocked(item, blocker, status);
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
    // A flag of false beats a blocker object, so no title rides along then.
    blockerTitle: blocked
      ? blocker?.title || pickString(item, ['blockReason', 'block_reason', 'reason'])
      : '',
    blockerOwner: blocked ? blocker?.owner || '' : '',
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

const ISSUE_ID_KEYS = ['issueId', 'issue_id'];
const ISSUE_NUMBER_KEYS = ['number', 'issueNumber', 'issue_number'];
const ISSUE_FLOWS_KEYS = ['flows', 'workflows'];

/**
 * An entry for one open maintenance report rather than one flow: it names the
 * report (its platform issueId or number) and lists the flows it parks.
 */
function isIssueItem(item) {
  const named =
    pickString(item, ISSUE_ID_KEYS) !== '' || pickNumber(item, ISSUE_NUMBER_KEYS) !== null;
  return named && Array.isArray(pick(item, ISSUE_FLOWS_KEYS));
}

/**
 * One open maintenance report as Task Wolf sees it: its verdict is the
 * report's, for every flow it parks. `issueId` is the platform's issue id and
 * each flow's `workflowId` the platform flow id, so both tie to the snapshot.
 */
export function normalizeMaintenanceIssue(item, now = Date.now()) {
  const blocker = readBlocker(item);
  const status = pickString(item, ['issueStatus', 'issue_status', 'status', 'state']);
  const blocked = readBlocked(item, blocker, status);
  const flows = pick(item, ISSUE_FLOWS_KEYS);
  const flowIds = (Array.isArray(flows) ? flows : []).map((flow) =>
    typeof flow === 'string'
      ? flow.trim()
      : pickString(flow, ['workflowId', 'workflow_id', 'flowId', 'flow_id', 'id']),
  );
  return {
    issueId: pickString(item, ISSUE_ID_KEYS),
    number: pickNumber(item, ISSUE_NUMBER_KEYS),
    name: pickString(item, ['name', 'title']),
    blocked,
    // As for a flow: a flag of false beats a blocker object.
    blockerTitle: blocked ? blocker?.title || '' : '',
    // The QAEs on this report's own tasks.
    assignees: pickPeople(item, ['assignees', 'qaes', 'assignee', 'assigneeName', 'qae']),
    flowIds: [...new Set(flowIds.filter(Boolean))],
    ageDays:
      pickNumber(item, ['ageDays', 'age_days', 'age']) ??
      daysSince(pick(item, ['createdAt', 'created_at']), now),
    status,
    url: pickString(item, ['link', 'url', 'href']),
  };
}

/**
 * A report's flows as flow entries, each carrying the report's verdict, so the
 * flow counts, the blocker roll-up and the flow maps read one list either way.
 */
function issueFlowEntries(issue) {
  return issue.flowIds.map((flowId) => ({
    flowId,
    name: issue.name,
    blocked: issue.blocked,
    blockerTitle: issue.blockerTitle,
    blockerOwner: '',
    ageDays: issue.ageDays,
    // One name per flow here; `annotateReport` reads all of them off the report.
    assignee: issue.assignees[0] || '',
    status: issue.status,
    url: issue.url,
  }));
}

// Named for flows, so an answer by report cannot mistake a count of reports
// for them; the flow-shaped answer also reads the bare names.
const FLOW_TOTAL_KEYS = [
  'flowsInMaintenance',
  'flows_in_maintenance',
  'inMaintenance',
  'in_maintenance',
  'maintenanceCount',
  'maintenance_count',
  'openMaintenance',
  'open_maintenance',
  'totalInMaintenance',
];
const BLOCKED_FLOW_KEYS = ['blockedFlows', 'blocked_flows', 'flowsBlocked', 'flows_blocked'];
const FREE_FLOW_KEYS = [
  'unblockedFlows',
  'unblocked_flows',
  'actionableFlows',
  'actionable_flows',
  'flowsNotBlocked',
  'flows_not_blocked',
];
const ISSUE_COUNT_KEYS = [
  'openMaintenanceIssues',
  'open_maintenance_issues',
  'openIssues',
  'open_issues',
  'issueCount',
  'issue_count',
];

/**
 * `get_maintenance_status` -> counts plus the per-flow list when the server
 * sends one. Explicit summary numbers win over counting items, because a
 * bounded list may be truncated.
 *
 * Task Wolf answers one entry per open report (`issueId`, `number`, `blocked`,
 * `assignees`, `flows: [{ workflowId }]`) under a summary of the customer's
 * flow counts (`flowsInMaintenance`, `flowsBlocked`, `flowsNotBlocked`) and
 * report count (`openMaintenanceIssues`). Those reports come back as `issues`,
 * and their flows as `items`, each carrying its report's verdict. An answer
 * with one entry per flow (the older shape) has `issues: null`; the entries
 * say which shape it is. By report, a `total` beside the list counts reports,
 * so only counts named for flows are read as flow counts, and the list is cut
 * short when it is flagged so or holds fewer reports than stated.
 *
 * When the list was cut short and no blocked / actionable number was stated,
 * the answer is `partial`: the two counts are floors (what the listed items
 * show), and a floor of zero is null, because the flows that were not listed
 * could be either. Nothing is derived from the total then. An answer with no
 * recognised count and no items is unknown (null), like prose. Counts sent
 * without a list make a total only when both are stated, so a count nobody
 * gave is never worked out from an empty list.
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
  const listKeys = [
    'flows',
    'maintenanceFlows',
    'maintenance_flows',
    'flowsInMaintenance',
    'inMaintenance',
    'openMaintenance',
    'maintenance',
  ];
  const list = findList(source, listKeys);
  const listed = list?.items || [];
  // A bounded list may sit one level down (`{ data: { total, truncated, items } }`):
  // the object it sits in bounds it as much as the top of the answer does.
  const bounds = [source, list?.holder].filter(isObject);

  const readCount = (names, objects = summary) => {
    for (const obj of objects) {
      const value = pickNumber(obj, names);
      if (value !== null) return value;
    }
    return null;
  };

  const statedIssues = readCount(ISSUE_COUNT_KEYS);
  // One entry per report, or (with nothing listed) a count of reports.
  const byIssue = listed.length ? listed.some(isIssueItem) : statedIssues !== null;
  const issues = byIssue ? listed.map((item) => normalizeMaintenanceIssue(item, now)) : null;
  const items = byIssue
    ? issues.flatMap(issueFlowEntries)
    : listed.map((item) => normalizeMaintenanceItem(item, now));
  const listTotal = readCount(['total', 'count'], bounds);

  const statedTotal = byIssue
    ? readCount(FLOW_TOTAL_KEYS)
    : readCount([...FLOW_TOTAL_KEYS, 'total', 'count'], [...summary, ...bounds]);
  const statedBlocked = readCount(
    byIssue
      ? BLOCKED_FLOW_KEYS
      : ['blocked', ...BLOCKED_FLOW_KEYS, 'blockedCount', 'blocked_count'],
  );
  const statedActionable = readCount(
    byIssue
      ? FREE_FLOW_KEYS
      : ['actionable', 'unblocked', 'notBlocked', 'not_blocked', ...FREE_FLOW_KEYS],
  );
  // `{ message: 'No customer matched' }`: JSON, but about nothing.
  if (
    statedTotal === null &&
    statedBlocked === null &&
    statedActionable === null &&
    statedIssues === null &&
    listed.length === 0
  ) {
    return null;
  }

  const issueTotal = byIssue ? (statedIssues ?? listTotal) : null;
  const truncated =
    flaggedCutShort([...bounds, ...summary]) || (issueTotal !== null && issues.length < issueTotal);
  // The list is the whole story only when the server did not cut it short,
  // and only when it sent one: counts with no list are not a list of nothing.
  // By report, the number of reports stated is what the list is measured by.
  const measure = byIssue ? issueTotal : statedTotal;
  const complete =
    !truncated &&
    (measure === null ? carriesList(source, listKeys) : (issues || items).length >= measure);
  // Both counts stated make a total; one alone does not.
  const statedSum =
    statedBlocked !== null && statedActionable !== null ? statedBlocked + statedActionable : null;
  const total = statedTotal ?? statedSum ?? (complete ? items.length : null);
  const blockedFromItems = items.filter((i) => i.blocked).length;

  let blocked = statedBlocked;
  let actionable = statedActionable;
  let partial = false;
  if (blocked === null && actionable === null) {
    // Nothing stated, so the list is counted.
    blocked = blockedFromItems;
    actionable = items.length - blockedFromItems;
    if (!complete) {
      // Cut short, it only puts a floor under each count, and a floor of zero
      // says nothing: the flows it left out could be either.
      partial = true;
      blocked = blocked || null;
      actionable = actionable || null;
    }
  } else if (total !== null) {
    if (blocked === null) blocked = Math.max(0, total - actionable);
    if (actionable === null) actionable = Math.max(0, total - blocked);
  }

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
    truncated,
    partial,
    items,
    issues,
    blockers: [...blockers.values()].sort((a, b) => b.flows - a.flows),
    url: pickString(source, ['url', 'link', 'taskWolfUrl', 'task_wolf_url', 'hqUrl', 'hq_url']),
  };
}

/** One task-board row. */
export function normalizeTask(item, now = Date.now()) {
  const status = pickString(item, ['status', 'state']);
  const blocker = readBlocker(item);
  const blocked = readBlocked(item, blocker, status);
  const dueAt = pick(item, ['dueAt', 'due_at', 'dueDate', 'due_date', 'due']);
  const createdAt = pick(item, ['createdAt', 'created_at', 'created', 'openedAt']);
  const dueDays = daysSince(dueAt, now);
  return {
    id: pickString(item, ['id', 'taskId', 'task_id', 'key']),
    title: pickString(item, ['title', 'name', 'summary']),
    type: pickString(item, ['type', 'taskType', 'task_type', 'category']),
    status,
    open: !CLOSED_TASK_STATUS_RE.test(status || ''),
    blocked,
    blockerTitle: blocked ? blocker?.title || '' : '',
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
 * the filter asked for.
 *
 * Unknown (null) rather than "no open tasks": prose, JSON with no list in it
 * (`{ message: 'No customer matched' }`; only a stated zero counts without
 * one), and open rows that are all of other types when no row reads as
 * maintenance -- the server's word for it may be one we do not know.
 *
 * A list cut short (Task Wolf sends the first 100) also carries `openTotal` /
 * `blockedTotal` when the answer states them for the whole list (see
 * `statedTaskCounts`); a whole list is counted as it stands.
 */
export function normalizeTasks(raw, now = Date.now()) {
  const body = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!isObject(body) && !Array.isArray(body)) return null;
  if (!carriesList(body, ['tasks'])) {
    return pickNumber(body, ['total', 'count']) === 0 ? { tasks: [], truncated: false } : null;
  }
  const list = findList(body, ['tasks']);
  const items = (list?.items || []).map((item) => normalizeTask(item, now));
  const isMaintenance = (t) => MAINTENANCE_TYPE_RE.test(t.type);
  const open = items.filter((t) => t.open);
  const tasks = open.filter((t) => !t.type || isMaintenance(t));
  if (open.length > 0 && tasks.length === 0 && !items.some(isMaintenance)) return null;
  // Cut short as the maintenance list is: flagged on the answer or on the
  // object the list sits in, or fewer rows sent than the total stated there.
  const bounds = [body, list?.holder].filter(isObject);
  const total = bounds.map((obj) => pickNumber(obj, ['total', 'count'])).find((n) => n !== null);
  const truncated = flaggedCutShort(bounds) || (total !== undefined && items.length < total);
  return truncated
    ? { tasks, truncated, ...statedTaskCounts(bounds, items, total) }
    : { tasks, truncated };
}

/**
 * What a task list cut short states about the whole of it: `byStatus` counts
 * every status (the closed ones are left out here), and a bare `total` counts
 * open tasks, because `maintenanceTaskArguments` sends no `statuses` and Task
 * Wolf's default is open tasks. Nothing is taken when those counts take in
 * rows this reading drops: another task type (in `byType`, or a row of one on
 * the page), or, for a bare total, a closed row on the page.
 */
function statedTaskCounts(bounds, rows, total) {
  const countsUnder = (names) => bounds.map((obj) => pick(obj, names)).find(isObject) || null;
  const byStatus = countsUnder(['byStatus', 'by_status', 'statusCounts', 'status_counts']);
  const byType = countsUnder(['byType', 'by_type', 'typeCounts', 'type_counts']);
  const otherType = (type) => Boolean(type) && !MAINTENANCE_TYPE_RE.test(type);
  if (
    rows.some((t) => otherType(t.type)) ||
    Object.keys(byType || {}).some((type) => otherType(type) && pickNumber(byType, [type]) > 0)
  ) {
    return {};
  }
  if (byStatus) {
    const sum = (keep) =>
      Object.keys(byStatus)
        .filter(keep)
        .reduce((acc, status) => acc + (pickNumber(byStatus, [status]) ?? 0), 0);
    const open = (status) => !CLOSED_TASK_STATUS_RE.test(status);
    return {
      openTotal: sum(open),
      blockedTotal: sum((status) => open(status) && statusSaysBlocked(status)),
    };
  }
  return total !== undefined && rows.every((t) => t.open) ? { openTotal: total } : {};
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
  // Who is on it, how overdue and how old are read off the rows sent, so a
  // list cut short undercounts them; the open and blocked counts below take
  // the numbers stated for the whole list when there are some.
  const assignees = [...new Set(taskRows.map((t) => t.assignee).filter(Boolean))];
  const oldestTask = taskRows.reduce(
    (acc, t) => (t.ageDays !== null && (acc === null || t.ageDays > acc) ? t.ageDays : acc),
    null,
  );
  const flows = (maintenance?.items || []).filter((i) => i.flowId);
  return {
    flowsInMaintenance: maintenance ? maintenance.flowsInMaintenance : null,
    blockedFlows: maintenance ? maintenance.blockedFlows : null,
    actionableFlows: maintenance ? maintenance.actionableFlows : null,
    // True when the list was cut short: the two counts above are then floors.
    partial: Boolean(maintenance?.partial),
    blockers: maintenance ? maintenance.blockers : [],
    // Every flow Task Wolf listed, blocked or not: a flow missing from here
    // is one Task Wolf said nothing about, not a free one. Null when the
    // maintenance answer is missing: no list at all, not a list of nothing.
    listedFlowIds: maintenance ? [...new Set(flows.map((i) => i.flowId))] : null,
    blockedFlowIds: maintenance
      ? [...new Set(flows.filter((i) => i.blocked).map((i) => i.flowId))]
      : null,
    flowBlockers: Object.fromEntries(
      flows.filter((i) => i.blocked && i.blockerTitle).map((i) => [i.flowId, i.blockerTitle]),
    ),
    flowAssignees: Object.fromEntries(
      flows.filter((i) => i.assignee).map((i) => [i.flowId, i.assignee]),
    ),
    // Task Wolf's own verdict on each open report, when it answers by report
    // (null when it answers by flow, or not at all): the report's call, its
    // blocker and the QAEs on it, for `annotateReport` to tie to the platform's
    // reports by issueId or number.
    issues: maintenance?.issues
      ? maintenance.issues.map(({ issueId, number, blocked, blockerTitle, assignees: qaes }) => ({
          issueId,
          number,
          blocked,
          blockerTitle,
          assignees: qaes,
        }))
      : null,
    // That list of reports was cut short, so one missing from it may be open.
    issuesCutShort: Boolean(maintenance?.issues && maintenance.truncated),
    openTasks: tasks ? (tasks.openTotal ?? taskRows.length) : null,
    blockedTasks: tasks ? (tasks.blockedTotal ?? taskRows.filter((t) => t.blocked).length) : null,
    overdueTasks: tasks ? taskRows.filter((t) => t.overdue).length : null,
    assignees,
    oldestTaskAgeDays: oldestTask,
    tasks: taskRows.slice(0, 25),
    // True when either list was partial, flagged by the server or not.
    // `partial` is the narrower one: the maintenance counts are floors.
    truncated: Boolean(maintenance?.truncated || maintenance?.partial || tasks?.truncated),
    url: maintenance?.url || taskRows.find((t) => t.url)?.url || '',
  };
}

/** The value seen most often, first seen winning a tie; '' for an empty list. */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let best = '';
  for (const [value, count] of counts) {
    if (count > (counts.get(best) || 0)) best = value;
  }
  return best;
}

/**
 * How a report reads once Task Wolf has spoken. `blocked` is a tri-state:
 * true / false / null, and null is the default -- only what Task Wolf
 * positively said moves it:
 *
 * - a flow of the report that Task Wolf listed as not blocked makes the
 *   report actionable (there is something to work on);
 * - every flow of the report listed as blocked makes it blocked;
 * - flows Task Wolf did not list (another id space, or a list cut short) are
 *   spoken for only by a customer-wide answer -- none of the customer's flows
 *   blocked, or all of them -- and only when that count is exact and not
 *   about zero flows. Otherwise the report stays unknown.
 * - a report that parks no flows (every one healed) has nothing to be
 *   blocked, so it stays unknown too.
 *
 * `blockedFlowIds` / `freeFlowIds` are the report's own flows Task Wolf listed
 * as blocked / as free, so a flow two reports park is counted once. They and
 * the three counts are null when the maintenance answer is missing (only
 * `find_tasks` answered): nothing was said about the flows, which is not zero.
 *
 * `assignees` are the QAEs on the report's own flows; `customerAssignees` are
 * the QAEs with an open maintenance task for the customer, which may or may
 * not be about this report.
 *
 * When Task Wolf answers by report, none of the above applies: see
 * `issueVerdict`.
 */
export function annotateReport(report, customerTw) {
  if (!customerTw) return { ...report, taskWolf: null };
  if (Array.isArray(customerTw.issues)) {
    return { ...report, taskWolf: issueVerdict(report, customerTw) };
  }
  const flowIds = report.flowIds || [];
  // Zero of zero flows is the platform's word, whatever Task Wolf answered.
  const flowsKnown = Array.isArray(customerTw.listedFlowIds) || flowIds.length === 0;
  const blockedIds = new Set(customerTw.blockedFlowIds || []);
  const listedIds = new Set(customerTw.listedFlowIds || []);
  const blockedHere = flowIds.filter((id) => blockedIds.has(id));
  const freeHere = flowIds.filter((id) => listedIds.has(id) && !blockedIds.has(id));
  const unlisted = flowIds.length - blockedHere.length - freeHere.length;

  let blocked = null;
  if (freeHere.length > 0) blocked = false;
  else if (flowIds.length > 0 && unlisted === 0) blocked = true;
  else if (flowIds.length > 0 && !customerTw.partial && customerTw.flowsInMaintenance > 0) {
    if (customerTw.blockedFlows === 0 && blockedHere.length === 0) blocked = false;
    else if (customerTw.actionableFlows === 0) blocked = true;
  }

  let blockerTitle = '';
  if (blocked) {
    // The report's own blocker; the customer's most common one only stands in
    // when the customer-wide count decided.
    blockerTitle = blockedHere.length
      ? mostCommon(blockedHere.map((id) => customerTw.flowBlockers?.[id]).filter(Boolean))
      : customerTw.blockers?.[0]?.title || '';
  }

  const assignees = flowIds.map((id) => customerTw.flowAssignees?.[id]).filter(Boolean);
  return {
    ...report,
    taskWolf: {
      blocked,
      blockedFlows: flowsKnown ? blockedHere.length : null,
      actionableFlows: flowsKnown ? freeHere.length : null,
      unlistedFlows: flowsKnown ? unlisted : null,
      blockedFlowIds: flowsKnown ? blockedHere : null,
      freeFlowIds: flowsKnown ? freeHere : null,
      partial: Boolean(customerTw.partial),
      blockerTitle: blocked ? blockerTitle || 'Blocked' : '',
      assignees: [...new Set(assignees)],
      customerAssignees: [...(customerTw.assignees || [])],
      openTasks: customerTw.openTasks ?? null,
    },
  };
}

/**
 * A report read off Task Wolf's own entry for it, found by the platform
 * issueId, else by report number. Task Wolf's verdict is per report: a
 * blocked report's flows are all blocked, a free one's are all free to work,
 * and the QAEs are the ones on its own tasks. A report it does not list gets
 * no verdict, whatever the customer-wide counts say: a whole list that leaves
 * it out means Task Wolf does not have it open, and a list cut short says
 * nothing about it (`partial`).
 */
function issueVerdict(report, customerTw) {
  const flowIds = report.flowIds || [];
  const flowCount = report.flowCount ?? flowIds.length;
  const number = report.number ?? null;
  const issue =
    customerTw.issues.find((i) => report.issueId && i.issueId === report.issueId) ||
    customerTw.issues.find((i) => number !== null && i.number === Number(number));
  const blocked = issue ? issue.blocked : null;
  return {
    blocked,
    blockedFlows: blocked ? flowCount : 0,
    actionableFlows: blocked === false ? flowCount : 0,
    unlistedFlows: issue ? 0 : flowCount,
    blockedFlowIds: blocked ? [...flowIds] : [],
    freeFlowIds: blocked === false ? [...flowIds] : [],
    partial: issue ? false : Boolean(customerTw.issuesCutShort),
    blockerTitle: blocked ? issue.blockerTitle || 'Blocked' : '',
    assignees: issue ? [...issue.assignees] : [],
    customerAssignees: [...(customerTw.assignees || [])],
    openTasks: customerTw.openTasks ?? null,
  };
}

/**
 * Task Wolf answered that it has no such customer (`No customer matched
 * "<value>"`), as a tool error: a former customer, most often, whose open
 * reports park nothing. Not a failure of Task Wolf.
 */
export function isCustomerNotFound(error) {
  return error?.code === 'TW_TOOL' && /no customer matched/i.test(String(error.message || ''));
}

/**
 * Fold the Task Wolf pass into a platform snapshot. Rows without Task Wolf
 * data keep `taskWolf: null`; totals count only what Task Wolf confirmed, so
 * "blocked" never grows from an absent answer and a count nobody gave stays
 * null rather than becoming a zero.
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
  const partialRows = rows.filter((c) => c.taskWolf.partial);
  // Sum of the counts Task Wolf gave; null when it gave none at all.
  const sumKnown = (key) => {
    const known = rows.map((c) => c.taskWolf[key]).filter((n) => typeof n === 'number');
    return known.length ? known.reduce((sum, n) => sum + n, 0) : null;
  };
  const totals = {
    ...snapshot.totals,
    customersWithTaskWolf: rows.length,
    blockedFlows: sumKnown('blockedFlows'),
    actionableFlows: sumKnown('actionableFlows'),
    blockedReports: reportRows.filter((r) => r.taskWolf?.blocked === true).length,
    actionableReports: reportRows.filter((r) => r.taskWolf?.blocked === false).length,
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
      customersPartial: partialRows.length,
      startedAt: meta.startedAt || null,
      finishedAt: meta.finishedAt || null,
      tools: meta.tools || null,
    },
  };
}
