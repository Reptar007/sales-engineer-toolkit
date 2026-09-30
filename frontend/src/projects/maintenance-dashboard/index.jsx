import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fetchMaintenanceDashboard, fetchMaintenanceStatus } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import {
  ageBucket,
  customerReportsLabel,
  customersWithVisibleReports,
  describeAge,
  describeScanError,
  describeTruncatedWorkspaces,
  downloadText,
  filterCustomers,
  filterReports,
  formatDate,
  formatDateTime,
  localIsoDate,
  reportsToCsv,
  slackSummary,
  statusLabel,
  summarize,
  taskWolfBadge,
  taskWolfBlockedLabel,
  taskWolfFlowsLabel,
  taskWolfNotFoundLevel,
  taskWolfQae,
  taskWolfVerdict,
} from './backlogView';
import './MaintenanceDashboard.css';

/**
 * Bone Pile — the maintenance backlog across every customer.
 *
 * Two questions, two lists: which customers have the most tests parked in
 * maintenance (the culprits), and which reports have been sitting longest
 * (the bones). Everything on the page is read from one server snapshot; the
 * toolbar filters that snapshot in the browser, and the tiles are totalled
 * from the same filtered rows the tables render, so they can never disagree.
 *
 * The platform API supplies the reports and their ages. Task Wolf (via its
 * MCP, when a token is configured) adds the two things an SE needs before
 * picking a bone: whether the parked flows are blocked on the customer, and
 * whether a QAE already has a maintenance task on it.
 *
 * The scan behind the snapshot is slow (one QA Wolf call per workspace, then
 * two Task Wolf calls per customer with backlog), so the page never waits on
 * it: a fresh snapshot answers instantly, a stale one answers while a rebuild
 * runs, and the first-ever load shows progress.
 *
 * The snapshot is large, so it is downloaded when it has changed and not
 * before: while a scan runs, and every few minutes while nothing does, the
 * page asks the status route, which is a few hundred bytes and starts nothing.
 */

const POLL_MS = 4000;
const IDLE_POLL_MS = 5 * 60 * 1000;
const CULPRITS_PREVIEW = 15;
const REPORTS_PREVIEW = 200;

const TASK_WOLF_MAINTENANCE_TOOL = 'get_maintenance_status';
const TASK_WOLF_TASKS_TOOL = 'find_tasks';
const TASK_WOLF_DOCS_URL = 'https://www.task-wolf.com/docs/users/automation/mcp/user-guide.html';
const TASK_WOLF_CONNECT_URL = 'https://www.task-wolf.com/settings/connect-claude';

function TaskWolfBadge({ row }) {
  const badge = taskWolfBadge(row);
  return (
    <span className={`bone-tw-badge bone-tw-badge--${badge.verdict}`} title={badge.title}>
      {badge.label}
    </span>
  );
}

/**
 * Who is on a report. A QAE who only has a task for the customer is shown
 * muted and named as such, never as being on this report.
 */
function TaskWolfQae({ row }) {
  const qae = taskWolfQae(row);
  if (!qae) return null;
  return (
    <span className={`bone-tw-qae bone-tw-qae--${qae.scope}`} title={qae.title}>
      {qae.text}
    </span>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="bone-tile">
      <div className="bone-tile-label">{label}</div>
      <div className="bone-tile-value">{value}</div>
      {sub ? <div className="bone-tile-sub">{sub}</div> : null}
    </div>
  );
}

function ScanProgress({ progress }) {
  const total = progress?.total || 0;
  const scanned = progress?.scanned || 0;
  const pct = total ? Math.round((scanned / total) * 100) : 0;
  const taskWolfPhase = progress?.phase === 'taskwolf';
  let text;
  if (taskWolfPhase) {
    text = total
      ? `Asking Task Wolf about customer ${scanned.toLocaleString()} of ${total.toLocaleString()}…`
      : 'Asking Task Wolf…';
  } else {
    text = total
      ? `Scanning workspace ${scanned.toLocaleString()} of ${total.toLocaleString()}…`
      : 'Listing workspaces…';
  }
  return (
    <div className="bone-progress" role="status" aria-live="polite">
      <div className="bone-progress-track">
        <div className="bone-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="bone-progress-text">
        {text}
        {progress?.failed ? ` (${progress.failed} failed so far)` : ''}
      </div>
    </div>
  );
}

/**
 * A server's message as a sentence of its own, so another can follow it. A
 * closing quote or bracket after the full stop still ends the sentence.
 */
function asSentence(message) {
  const text = String(message || '').trim();
  return !text || /[.!?…]["'”’)\]]*$/.test(text) ? text : `${text}.`;
}

// What each tool answers, so a notice calls unknown only what a missing or
// failed one lost: get_maintenance_status gives the blocked status and the QAE
// on each of a report's flows, find_tasks the customer's QAEs and open tasks.
const LOST_WITHOUT_MAINTENANCE = 'blocked status and per-report QAEs';
const LOST_WITHOUT_TASKS = 'customer-level QAEs and open tasks';

/**
 * What the failed Task Wolf calls leave unknown, in one sentence. The service
 * records an error per failed tool call, up to two for one customer, so the
 * customers are counted by workspace. Only what a failed tool answers is
 * called unknown (LOST_WITHOUT_*); an error that names no tool lost both.
 */
function describeTaskWolfFailures(errors) {
  const customers = new Set();
  const status = new Set();
  const tasks = new Set();
  for (const failure of errors) {
    const id = failure.workspaceId || failure.workspaceName;
    customers.add(id);
    if (failure.tool !== TASK_WOLF_TASKS_TOOL) status.add(id);
    if (failure.tool !== TASK_WOLF_MAINTENANCE_TOOL) tasks.add(id);
  }
  const who = `${customers.size.toLocaleString()} ${customers.size === 1 ? 'customer' : 'customers'}`;
  if (status.size && tasks.size && status.size + tasks.size < customers.size * 2) {
    return `Task Wolf couldn't answer for ${who}: ${LOST_WITHOUT_MAINTENANCE} are unknown for ${status.size.toLocaleString()} and ${LOST_WITHOUT_TASKS} for ${tasks.size.toLocaleString()}.`;
  }
  let what = LOST_WITHOUT_TASKS;
  if (status.size && tasks.size) what = 'blocked status, QAEs and open tasks';
  else if (status.size) what = LOST_WITHOUT_MAINTENANCE;
  return `Task Wolf couldn't answer for ${who}; their ${what} are unknown.`;
}

/**
 * Whether the QAE on every report is known, so the tile may say none has one.
 * It comes with get_maintenance_status, so a server without it, a pass that
 * broke off or a customer whose call failed leaves some reports' QAE unknown.
 */
function reportQaeKnown(taskWolf) {
  if (!taskWolf?.enabled || taskWolf.pending || taskWolf.error) return false;
  if (taskWolf.tools?.maintenance === false) return false;
  return !(taskWolf.errors || []).some((failure) => failure.tool !== TASK_WOLF_TASKS_TOOL);
}

/**
 * One line about the Task Wolf pass: how much of the backlog it covered, or
 * why it is missing. A stale token is the one failure an SE can fix alone,
 * so it says exactly where to go.
 */
function TaskWolfNotice({ taskWolf }) {
  if (!taskWolf) return null;
  if (taskWolf.pending) {
    return (
      <div className="bone-hint" role="status">
        Task Wolf is still being asked about these customers. Blocked status and the QAE on each
        report will fill in when it has answered.
      </div>
    );
  }
  if (!taskWolf.enabled) {
    return (
      <div className="bone-hint">
        Task Wolf isn&apos;t connected, so blocked status and QAE ownership are unknown. Set{' '}
        <code>TASK_WOLF_MCP_TOKEN</code> on the server (mint one at{' '}
        <a href={TASK_WOLF_CONNECT_URL} target="_blank" rel="noreferrer noopener">
          Task Wolf → Settings → Connect Claude
        </a>
        ) and rescan.{' '}
        <a href={TASK_WOLF_DOCS_URL} target="_blank" rel="noreferrer noopener">
          MCP docs
        </a>
      </div>
    );
  }
  if (taskWolf.error?.code === 'TW_AUTH') {
    return (
      <div className="bone-warning">
        Task Wolf rejected the MCP token (they last 90 days). Mint a new one at{' '}
        <a href={TASK_WOLF_CONNECT_URL} target="_blank" rel="noreferrer noopener">
          Task Wolf → Settings → Connect Claude
        </a>
        , update <code>TASK_WOLF_MCP_TOKEN</code>, and rescan. Blocked status below is{' '}
        {taskWolf.customersAnswered ? 'partial' : 'missing'}.
      </div>
    );
  }
  if (taskWolf.error) {
    // A pass that cut itself short says why in full sentences of its own.
    const lead =
      taskWolf.error.code === 'TW_ABORTED'
        ? ''
        : `Task Wolf could not be read (${taskWolf.error.code || 'error'}): `;
    return (
      <div className="bone-warning">
        {lead}
        {asSentence(taskWolf.error.message)} Blocked status and QAE ownership below are{' '}
        {taskWolf.customersAnswered ? 'partial' : 'missing'}.
      </div>
    );
  }
  // A server that offers one tool of the two answers half the question for
  // everyone, without a single failed call to show for it.
  const tools = taskWolf.tools;
  const missingTool = tools && Boolean(tools.maintenance) !== Boolean(tools.tasks);
  const first = taskWolf.errors?.[0];
  if (!missingTool && !first) return null;
  return (
    <>
      {missingTool ? (
        <div className="bone-warning">
          This Task Wolf server doesn&apos;t offer{' '}
          <code>{tools.maintenance ? TASK_WOLF_TASKS_TOOL : TASK_WOLF_MAINTENANCE_TOOL}</code>, so{' '}
          {tools.maintenance ? LOST_WITHOUT_TASKS : LOST_WITHOUT_MAINTENANCE} are unknown for every
          customer.{' '}
          {tools.maintenance
            ? 'Blocked status and per-report QAEs below are what Task Wolf answered.'
            : "The QAEs below are the customer's, not any one report's."}
        </div>
      ) : null}
      {first ? (
        <div className="bone-warning">
          {describeTaskWolfFailures(taskWolf.errors)} First: {first.workspaceName}
          {first.tool ? ` (${first.tool})` : ''} — {first.message}
        </div>
      ) : null}
    </>
  );
}

/**
 * A list Task Wolf cut short counts only the flows it got to, so what it says
 * of those customers is a floor. Said once here, and again on each of their
 * rows among the culprits.
 */
function TaskWolfPartialNotice({ taskWolf }) {
  const partial = taskWolf?.enabled && !taskWolf.pending ? taskWolf.customersPartial || 0 : 0;
  if (!partial) return null;
  return (
    <div className="bone-hint">
      Task Wolf cut its list short for {partial.toLocaleString()}{' '}
      {partial === 1 ? 'customer' : 'customers'}. Their blocked and actionable counts are lower
      bounds, and a report whose flows were left out reads as unknown.
    </div>
  );
}

/**
 * Task Wolf answered that it has no record of some customers: former ones,
 * mostly. Not a failure, so it is a hint, not a warning; it says why their
 * reports read as unknown. Most of the customers asked is another matter, and
 * a warning (see taskWolfNotFoundLevel).
 */
function TaskWolfNotFoundNotice({ taskWolf }) {
  const level = taskWolfNotFoundLevel(taskWolf);
  if (!level) return null;
  const count = taskWolf.customersNotInTaskWolf;
  if (level === 'warning') {
    return (
      <div className="bone-warning">
        Task Wolf has no record of {count.toLocaleString()} of the{' '}
        {taskWolf.customersQueried.toLocaleString()} customers with backlog, so their reports have
        no blocked status. That many former customers is unlikely: Task Wolf may no longer take the
        customer argument it is sent.
      </div>
    );
  }
  return (
    <div className="bone-hint">
      {count === 1
        ? "1 customer with backlog isn't in Task Wolf (a former customer, usually), so its reports have no blocked status."
        : `${count.toLocaleString()} customers with backlog aren't in Task Wolf (former customers, usually), so their reports have no blocked status.`}
    </div>
  );
}

/**
 * What Task Wolf said of a customer's blocked flows, for its row among the
 * culprits. No count is unknown, not none, and says so once Task Wolf has been
 * asked; a customer it counted nothing blocked for has nothing to say.
 */
function culpritBlockedLabel(customer, taskWolf) {
  const label = taskWolfBlockedLabel(customer.taskWolf);
  if (label || !taskWolf?.enabled || taskWolf.pending) return label;
  return typeof customer.taskWolf?.blockedFlows === 'number' ? '' : 'blocked unknown';
}

/**
 * The line under the reports tile. The verdicts add up to the tile above
 * them, so what Task Wolf said nothing about is counted too, as unknown. A
 * QAE on the report is counted apart from one who only has a task for the
 * customer. A count of none is left out where a notice calls it unknown
 * (`qaeKnown`: see reportQaeKnown).
 */
function reportsTileLabel(totals, { qaeKnown }) {
  const count = (n, what) => `${n.toLocaleString()} ${what}`;
  const parts = [];
  if (totals.withTaskWolf) {
    parts.push(count(totals.blockedReports, 'fully blocked'));
    parts.push(count(totals.actionableReports, 'actionable'));
    if (totals.unknownReports > 0) parts.push(count(totals.unknownReports, 'unknown'));
  }
  const ownQae = totals.withQae > 0 || (totals.withTaskWolf > 0 && qaeKnown);
  if (ownQae) parts.push(count(totals.withQae, 'with a QAE on it'));
  if (totals.withCustomerQae > 0) {
    parts.push(count(totals.withCustomerQae, `${ownQae ? 'more ' : ''}with a QAE on the customer`));
  }
  return parts.join(' · ');
}

/**
 * One report in the table. Memoised, and handed only props that keep their
 * identity from one render to the next (the row out of the snapshot,
 * booleans, a state setter), so a keystroke in the toolbar renders the rows
 * that changed rather than all of them. While Task Wolf is still being asked
 * (`askingTaskWolf`) its cell says so, not that Task Wolf said nothing.
 */
const ReportRow = memo(function ReportRow({ row, showTaskWolf, askingTaskWolf, onSelectCustomer }) {
  const label = `#${row.number ?? '?'} ${row.name}`;
  return (
    <tr className={`bone-age--${ageBucket(row.ageDays)}`}>
      <td className="bone-num" title={`Opened ${formatDate(row.createdAt)}`}>
        <span className="bone-age-days">{row.ageDays.toLocaleString()} d</span>
        <span className="bone-age-words">{describeAge(row.ageDays)}</span>
      </td>
      <td>
        <button
          type="button"
          className="bone-customer"
          onClick={() => onSelectCustomer(row.workspaceId)}
        >
          {row.workspaceName}
        </button>
        {row.isDemo ? <span className="bone-tag">demo</span> : null}
      </td>
      <td>
        {row.url ? (
          <a className="bone-report" href={row.url} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span className="bone-report">{label}</span>
        )}
        {row.description ? (
          <span className="bone-description" title={row.description}>
            {row.description}
          </span>
        ) : null}
      </td>
      <td className="bone-num">
        {row.flowCount}
        {row.healedFlowCount ? (
          <span className="bone-healed" title="reproductions no longer active">
            +{row.healedFlowCount} healed
          </span>
        ) : null}
      </td>
      {showTaskWolf ? (
        <td className="bone-tw">
          {askingTaskWolf ? (
            <span className="bone-tw-asking">asking…</span>
          ) : (
            <>
              <TaskWolfBadge row={row} />
              <TaskWolfQae row={row} />
              {taskWolfVerdict(row) === 'blocked' && row.taskWolf.blockerTitle ? (
                <span className="bone-tw-blocker">{row.taskWolf.blockerTitle}</span>
              ) : null}
            </>
          )}
        </td>
      ) : null}
      <td>
        {statusLabel(row.status)}
        {row.priority ? (
          <span className="bone-priority-folded">
            <span className="bone-priority">{row.priority}</span> priority
          </span>
        ) : null}
      </td>
      <td className="bone-priority bone-col-priority">{row.priority}</td>
      <td className="bone-col-opened">{formatDate(row.createdAt)}</td>
    </tr>
  );
});

/**
 * A scan is running and the server has no snapshot to send, which is the
 * first scan, or the first one since it restarted. A snapshot already on
 * screen stays there, marked as being rescanned, until the new one lands.
 * `refreshError` is the failed scan this one retries, as the server reports
 * it, and null when nothing failed before it.
 */
function whileBuilding(held, { progress, refreshError }) {
  const failure = refreshError || null;
  if (held?.status !== 'ready') {
    return { status: 'building', progress: progress || null, refreshError: failure };
  }
  return {
    ...held,
    stale: true,
    refreshing: true,
    progress: progress || null,
    refreshError: failure,
  };
}

/**
 * A failed scan in one line: when (if the server said), why, then `note`. The
 * server keeps the failure until a scan works, so it stays up while the retry
 * runs, and says a retry is running (`retrying`).
 */
function RefreshFailed({ failure, retrying = false, note = '' }) {
  const after = [asSentence(failure.message), retrying ? 'Retrying now.' : '', note];
  return (
    <div className="bone-warning" role="alert">
      Last refresh failed
      {failure.failedAt ? ` (${formatDateTime(failure.failedAt)})` : ''}:{' '}
      {after.filter(Boolean).join(' ')}
    </div>
  );
}

/**
 * Whether the toolbar offers the Task Wolf filter. Not while Task Wolf is
 * still being asked: every row is unknown until it answers, so the other
 * choices could only empty the table.
 */
function offersTaskWolfFilter(taskWolf) {
  return Boolean(taskWolf?.enabled && !taskWolf.pending);
}

/** A failed scan is worth rescanning; a failed request is worth asking again. */
function isScanFailure(error) {
  const code = String(error?.code || '');
  return code === 'SCAN_FAILED' || code.startsWith('QAW_');
}

/**
 * A request that failed, as fail() takes it: the message and code, and what
 * the server's answer said beside them. A failed scan says when it failed and
 * when a rescan may start (null: now); a request that got no such answer says
 * neither, and leaves them undefined.
 */
function requestFailure(err) {
  return {
    message: err?.message,
    code: err?.code,
    failedAt: err?.body?.failedAt,
    rescanAvailableAt: err?.body?.rescanAvailableAt,
  };
}

/** "Rescan at 4:05 PM", for a Rescan the server is holding back until `at` (ms). */
function rescanAtLabel(at) {
  return `Rescan at ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function MaintenanceDashboard() {
  const toast = useToast();

  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [hideDemos, setHideDemos] = useState(true);
  const [minFlows, setMinFlows] = useState(0);
  const [status, setStatus] = useState('all');
  const [sortKey, setSortKey] = useState('age');
  const [twFilter, setTwFilter] = useState('all');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
  const [showAllCulprits, setShowAllCulprits] = useState(false);

  // The rows the reader asked to see in full; any change to them folds the
  // table back to its first REPORTS_PREVIEW.
  const [expandedReports, setExpandedReports] = useState(null);

  // What is on screen, for the status check to compare the server's answer with.
  const held = useRef(null);
  useEffect(() => {
    held.current = payload;
  }, [payload]);

  // How many times fail() has run, so an answer can tell whether the failure
  // on screen is older than the question it answers.
  const failures = useRef(0);

  const fail = useCallback((failure) => {
    failures.current += 1;
    setError({
      message: failure?.message || 'Failed to load the maintenance backlog.',
      code: failure?.code || null,
      failedAt: failure?.failedAt || null,
      rescanAvailableAt: failure?.rescanAvailableAt || null,
    });
    // The scan this page was following failed or is out of reach: stop
    // polling and free the Rescan button, unless the answer says a rescan must
    // wait; an answer that said nothing of it leaves what the page knew. A
    // snapshot already on screen stays. A failed scan is the server's latest
    // word, so it replaces the failure the server reported before; a request
    // of the page's own leaves that up.
    const scanFailed = isScanFailure(failure);
    const said = failure?.rescanAvailableAt;
    setPayload((prev) =>
      prev?.status === 'ready'
        ? {
            ...prev,
            refreshing: false,
            progress: null,
            refreshError: scanFailed ? null : prev.refreshError,
            rescanAvailableAt: said === undefined ? prev.rescanAvailableAt : said,
          }
        : null,
    );
  }, []);

  /** Fetch the full payload. Resolves to the server's answer, or null when it failed. */
  const load = useCallback(
    async ({ refresh = false } = {}) => {
      try {
        const next = await fetchMaintenanceDashboard({ refresh });
        setPayload((prev) => (next.status === 'building' ? whileBuilding(prev, next) : next));
        setError(null);
        if (next.status === 'ready') {
          // A new snapshot: drop the choices it has nothing to show for, which
          // the toolbar would give the reader no control to undo.
          const listed = next.snapshot?.customers || [];
          setSelectedWorkspaceId((id) =>
            id && !listed.some((c) => c.workspaceId === id) ? null : id,
          );
          if (!offersTaskWolfFilter(next.snapshot?.taskWolf)) setTwFilter('all');
        }
        return next;
      } catch (err) {
        fail(requestFailure(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Ask where the scan stands and fetch the snapshot only when that says there
   * is one the page does not have: the first one, a newer one, or the end of
   * the scan it was following. An answer that lands after the poll that asked
   * was stopped (the page left, or a Rescan restarted it) is dropped, so a
   * page that is gone never downloads the snapshot.
   */
  const checkStatus = useCallback(
    async (cancelled) => {
      const wasIdle = held.current?.status === 'ready' && !held.current.refreshing;
      const failedBefore = failures.current;
      let answer;
      try {
        answer = await fetchMaintenanceStatus();
      } catch (err) {
        // An idle tab that could not ask simply asks again next time.
        if (!wasIdle && !cancelled()) fail(requestFailure(err));
        return;
      }
      if (cancelled()) return;
      const onScreen = held.current;
      if (!onScreen) return;
      // The server answered, so a request of this page's that failed before this
      // one was sent is history. A failure the answer reports is set below.
      if (failures.current === failedBefore) setError(null);
      const idle = onScreen.status === 'ready' && !onScreen.refreshing;

      if (answer.status === 'building') {
        setPayload((prev) => whileBuilding(prev, answer));
        return;
      }
      // Beside a failure, as beside a snapshot, the answer says when a rescan
      // may start, and Rescan follows it.
      if (answer.status !== 'ready') {
        if (idle && answer.error?.code === 'NO_SNAPSHOT') {
          // The server restarted and nobody has asked it for a scan yet. Nothing
          // failed; what is on screen is simply no longer what it would answer.
          setPayload((prev) =>
            prev?.status === 'ready'
              ? { ...prev, stale: true, rescanAvailableAt: answer.rescanAvailableAt || null }
              : prev,
          );
        } else {
          fail({ ...answer.error, rescanAvailableAt: answer.rescanAvailableAt });
        }
        return;
      }

      const changed =
        onScreen.status !== 'ready' ||
        answer.builtAt !== onScreen.builtAt ||
        (onScreen.refreshing && !answer.refreshing);
      // Asking for a snapshot that has aged out starts a scan, and an idle tab
      // must not start one. It says the snapshot is old and leaves it there.
      if (changed && !(idle && answer.stale)) {
        await load();
        return;
      }
      setPayload((prev) =>
        prev?.status === 'ready'
          ? {
              ...prev,
              stale: Boolean(answer.stale),
              refreshing: Boolean(answer.refreshing),
              progress: answer.progress || null,
              refreshError: answer.refreshError || null,
              rescanAvailableAt: answer.rescanAvailableAt || null,
            }
          : prev,
      );
    },
    [fail, load],
  );

  // While a scan runs, keep asking so the progress bar moves and the fresh
  // snapshot lands without a manual reload. While nothing runs, look in now
  // and then, so a page left open learns that its snapshot has aged or been
  // replaced. After a failure with nothing on screen, wait to be asked.
  const scanning = payload?.status === 'building' || Boolean(payload?.refreshing);
  const pollEvery = scanning ? POLL_MS : IDLE_POLL_MS;
  const following = Boolean(payload);
  useEffect(() => {
    if (!following) return undefined;
    let timer = null;
    let stopped = false;
    const ask = async () => {
      await checkStatus(() => stopped);
      if (!stopped) timer = setTimeout(ask, pollEvery);
    };
    timer = setTimeout(ask, pollEvery);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [following, pollEvery, checkStatus]);

  const snapshot = payload?.status === 'ready' ? payload.snapshot : null;

  // Typing stays ahead of the table: the input shows each keystroke at once
  // and the rows follow when the browser has a moment.
  const deferredSearch = useDeferredValue(search);

  // The culprits are how the reader picks a customer, so the status, min-flows
  // and focused-customer filters leave them alone. The Task Wolf filter keeps
  // the customers with a report that passes it, judged as the table judges.
  const customers = useMemo(() => {
    const listed = filterCustomers(snapshot?.customers, { search: deferredSearch, hideDemos });
    if (twFilter === 'all') return listed;
    const passing = filterReports(snapshot?.reports, { hideDemos: false, taskWolf: twFilter });
    return customersWithVisibleReports(listed, passing);
  }, [snapshot, deferredSearch, hideDemos, twFilter]);

  const reports = useMemo(
    () =>
      filterReports(snapshot?.reports, {
        search: deferredSearch,
        hideDemos,
        minFlows,
        status,
        sortKey,
        taskWolf: twFilter,
        workspaceId: selectedWorkspaceId,
      }),
    [snapshot, deferredSearch, hideDemos, minFlows, status, sortKey, twFilter, selectedWorkspaceId],
  );

  // Tiles, the export and the Slack digest cover every visible report; only
  // the table holds back, because rows are what cost time to draw.
  const totals = useMemo(() => summarize(reports), [reports]);
  const showAllReports = expandedReports === reports;
  const shownReports = useMemo(
    () => (showAllReports ? reports : reports.slice(0, REPORTS_PREVIEW)),
    [reports, showAllReports],
  );

  const selectedCustomer = useMemo(
    () =>
      selectedWorkspaceId
        ? (snapshot?.customers || []).find((c) => c.workspaceId === selectedWorkspaceId)
        : null,
    [snapshot, selectedWorkspaceId],
  );

  const culprits = showAllCulprits ? customers : customers.slice(0, CULPRITS_PREVIEW);
  const maxFlows = customers.length ? customers[0].flowsInMaintenance : 0;

  // The server makes a forced rescan wait a while after the last scan, since
  // each one is about 2,000 QA Wolf calls, and a short cool-down after one
  // that failed. Rescan stays off until then, beside a snapshot or on the page
  // that says the scan failed, and a timer brings it back without waiting for
  // the next poll. With no snapshot on screen, the failure says when.
  const rescanSaid = (snapshot ? payload : error)?.rescanAvailableAt;
  const rescanAvailableAt = rescanSaid ? Date.parse(rescanSaid) : 0;
  const [, setRescanOpened] = useState(0);
  useEffect(() => {
    const wait = rescanAvailableAt - Date.now();
    if (!(wait > 0)) return undefined;
    const timer = setTimeout(() => setRescanOpened((n) => n + 1), wait + 250);
    return () => clearTimeout(timer);
  }, [rescanAvailableAt]);
  const rescanWaiting = rescanAvailableAt > Date.now();

  const handleRescan = useCallback(async () => {
    // The button is off until then, so a click that gets here anyway asks for nothing.
    if (rescanAvailableAt > Date.now()) return;
    const next = await load({ refresh: true });
    // Said once the server has answered, since it may still hold the rescan
    // back for a scan that ran since this page last asked; the button then
    // says until when, and nothing says a rescan is running.
    if (next?.status === 'building' || next?.refreshing) {
      toast.info('Rescanning every workspace — this takes a few minutes.');
    }
  }, [load, toast, rescanAvailableAt]);

  const handleExport = useCallback(() => {
    // Today where the reader is; the UTC date is tomorrow's for a US evening.
    downloadText(`maintenance-backlog-${localIsoDate()}.csv`, reportsToCsv(reports));
  }, [reports]);

  const handleCopySlack = useCallback(async () => {
    // The digest is counted from the rows on screen; the customers only lend
    // their names, so it is handed all of them, not the culprit panel's list.
    const text = slackSummary({
      reports,
      customers: snapshot?.customers,
      generatedAt: snapshot?.generatedAt,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Slack summary copied.');
    } catch {
      toast.error('Could not copy to the clipboard — select the table and copy instead.');
    }
  }, [reports, snapshot, toast]);

  if (loading) {
    return (
      <div className="bone-pile">
        <div className="bone-loading">
          <div className="bone-spinner" />
          <h2>Digging up the bone pile…</h2>
          <p>Reading maintenance reports from QA Wolf</p>
        </div>
      </div>
    );
  }

  if (error && !snapshot) {
    const failure = describeScanError(error);
    // Only a scan that failed is worth running again. When it was this page's
    // request that failed, asking again is enough and costs upstream nothing,
    // and so it is with no key on the server: no scan can run until one is set.
    // The server holds a rescan back for a short cool-down after a failed
    // scan, and Rescan says until when, as it does beside a snapshot.
    const rescan = isScanFailure(error) && error.code !== 'QAW_CONFIG';
    const waiting = rescan && rescanWaiting;
    let label = 'Try again';
    if (rescan) label = waiting ? rescanAtLabel(rescanAvailableAt) : 'Rescan';
    return (
      <div className="bone-pile">
        <div className="bone-error" role="alert">
          <h2>{failure.title}</h2>
          <p>
            {error.failedAt ? `Last scan failed (${formatDateTime(error.failedAt)}): ` : ''}
            {failure.message}
          </p>
          {failure.hint ? <p className="bone-error-hint">{failure.hint}</p> : null}
          <button
            type="button"
            className="bone-btn"
            onClick={() => load({ refresh: rescan })}
            disabled={waiting}
            title={
              waiting
                ? 'The scan failed moments ago, so the server waits a short cool-down before another.'
                : undefined
            }
          >
            {label}
          </button>
        </div>
      </div>
    );
  }

  if (payload?.status === 'building' && !snapshot) {
    return (
      <div className="bone-pile">
        <header className="bone-header">
          <div>
            <div className="bone-overline">BONE PILE</div>
            <h1>Maintenance backlog</h1>
            <p>First scan of every workspace. The page fills in when it finishes.</p>
          </div>
        </header>
        {payload.refreshError ? <RefreshFailed failure={payload.refreshError} retrying /> : null}
        <ScanProgress progress={payload.progress} />
      </div>
    );
  }

  const scanTotals = snapshot?.totals || {};
  const scannedOk = Math.max(
    0,
    (scanTotals.workspacesScanned || 0) - (scanTotals.workspacesFailed || 0),
  );
  const scannedTotal = (scanTotals.workspacesScanned || 0).toLocaleString();
  const failedCount = scanTotals.workspacesFailed || 0;
  const failedSuffix = failedCount ? ` · ${failedCount} failed` : '';
  const scannedLabel = `${scannedOk.toLocaleString()} of ${scannedTotal} workspaces scanned${failedSuffix}`;
  const firstError = snapshot?.errors?.[0];
  const failedNoun = failedCount === 1 ? 'workspace' : 'workspaces';
  const failedLabel = failedCount
    ? `${failedCount} ${failedNoun} could not be read, so this backlog may be short.`
    : '';
  const truncatedLabel = describeTruncatedWorkspaces(snapshot?.truncatedWorkspaces);
  // The server's last rebuild may have failed, and so may this page's own last
  // request. Each gets its line, the server's first. A request of the page's
  // that failed says nothing of the scan, which may still be running, unless
  // the server answered it with a failed scan. The server's failure stays up
  // while a rescan retries it, and says so.
  const refreshFailures = [payload?.refreshError, error].filter(Boolean);
  const ownFailure = (failure) => failure === error && !isScanFailure(error);
  const taskWolf = snapshot?.taskWolf || null;
  // A first scan has its backlog on screen while Task Wolf is still asked.
  const scanningLabel = taskWolf?.pending ? 'Asking Task Wolf…' : 'Rescanning…';
  let taskWolfLabel = 'Task Wolf: not connected';
  if (taskWolf?.pending) {
    taskWolfLabel = 'Task Wolf: still being asked';
  } else if (taskWolf?.enabled) {
    taskWolfLabel = `Task Wolf: ${(taskWolf.customersAnswered || 0).toLocaleString()} of ${(
      taskWolf.customersQueried || 0
    ).toLocaleString()} customers answered`;
    // Those it has no record of are not among the answered, and not failures either.
    if (taskWolf.customersNotInTaskWolf > 0) {
      taskWolfLabel += ` · ${taskWolf.customersNotInTaskWolf.toLocaleString()} not in Task Wolf`;
    }
  }
  const reportsSub = reportsTileLabel(totals, { qaeKnown: reportQaeKnown(taskWolf) });
  const flowsSub = totals.withTaskWolf
    ? taskWolfFlowsLabel(totals)
    : 'distinct tests out of the suite';

  return (
    <div className="bone-pile">
      <header className="bone-header">
        <div>
          <div className="bone-overline">BONE PILE</div>
          <h1>Maintenance backlog</h1>
          <p>
            Every open maintenance report across QA Wolf, ranked by how long it has been sitting and
            by how many tests each customer has parked, with Task Wolf saying which bones are
            blocked on the customer and which already have a QAE gnawing. Pick a free one, tell the
            team, gnaw.
          </p>
        </div>
        <div className="bone-actions">
          <button type="button" className="bone-btn bone-btn--ghost" onClick={handleCopySlack}>
            Copy for Slack
          </button>
          <button type="button" className="bone-btn bone-btn--ghost" onClick={handleExport}>
            Export CSV
          </button>
          <button
            type="button"
            className="bone-btn"
            onClick={handleRescan}
            disabled={Boolean(payload?.refreshing) || rescanWaiting}
            title={
              rescanWaiting && !payload?.refreshing
                ? 'A scan ran recently. Each one reads every workspace, so rescans are spaced out.'
                : undefined
            }
          >
            {payload?.refreshing
              ? scanningLabel
              : rescanWaiting
                ? rescanAtLabel(rescanAvailableAt)
                : 'Rescan'}
          </button>
        </div>
      </header>

      <div className="bone-status">
        <span>
          Snapshot {formatDateTime(payload?.builtAt || snapshot?.generatedAt)}
          {payload?.stale ? ' · older than the cache window' : ''}
        </span>
        <span>{scannedLabel}</span>
        <span>{taskWolfLabel}</span>
        {snapshot?.excludedSlugs?.length ? (
          <span>Excluded: {snapshot.excludedSlugs.join(', ')}</span>
        ) : null}
        {payload?.refreshing ? <span className="bone-status-live">{scanningLabel}</span> : null}
      </div>

      {payload?.refreshing && payload?.progress ? (
        <ScanProgress progress={payload.progress} />
      ) : null}

      {refreshFailures.map((failure) =>
        ownFailure(failure) ? (
          <div className="bone-warning" role="alert" key="page">
            This page couldn&apos;t reach the server: {asSentence(failure.message)} It is showing
            the snapshot it already has.
          </div>
        ) : (
          <RefreshFailed
            key={failure === error ? 'page' : 'server'}
            failure={failure}
            retrying={failure !== error && Boolean(payload?.refreshing)}
            note="The snapshot below is the last one that worked."
          />
        ),
      )}

      {failedLabel ? (
        <div className="bone-warning">
          {failedLabel}
          {firstError ? ` First: ${firstError.workspaceName} — ${firstError.message}` : ''}
        </div>
      ) : null}

      {truncatedLabel ? <div className="bone-warning">{truncatedLabel}</div> : null}

      <TaskWolfNotice taskWolf={taskWolf} />
      <TaskWolfPartialNotice taskWolf={taskWolf} />
      <TaskWolfNotFoundNotice taskWolf={taskWolf} />

      <section className="bone-tiles">
        <Tile label="Customers with backlog" value={totals.customers.toLocaleString()} />
        <Tile
          label="Open maintenance reports"
          value={totals.reports.toLocaleString()}
          sub={reportsSub}
        />
        <Tile label="Flows parked" value={totals.flows.toLocaleString()} sub={flowsSub} />
        <Tile
          label="Oldest report"
          value={`${totals.oldestDays.toLocaleString()} d`}
          sub={describeAge(totals.oldestDays)}
        />
      </section>

      <div className="bone-toolbar">
        <input
          type="search"
          className="bone-search"
          placeholder="Filter by customer, report, or org…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="bone-checkbox">
          <input
            type="checkbox"
            checked={hideDemos}
            onChange={(e) => setHideDemos(e.target.checked)}
          />
          Hide demo &amp; sandbox workspaces
        </label>
        <label className="bone-select">
          Min flows
          <select value={minFlows} onChange={(e) => setMinFlows(Number(e.target.value))}>
            <option value={0}>any</option>
            <option value={2}>2+</option>
            <option value={5}>5+</option>
            <option value={10}>10+</option>
          </select>
        </label>
        <label className="bone-select">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">all open</option>
            <option value="pending">pending</option>
            <option value="inProgress">in progress</option>
            <option value="paused">paused</option>
          </select>
        </label>
        <label className="bone-select">
          Sort
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="age">Oldest first</option>
            <option value="flows">Most flows first</option>
            <option value="priority">Priority</option>
            <option value="customer">Customer A–Z</option>
          </select>
        </label>
        {offersTaskWolfFilter(taskWolf) ? (
          <label className="bone-select">
            Task Wolf
            <select value={twFilter} onChange={(e) => setTwFilter(e.target.value)}>
              <option value="all">all</option>
              <option value="actionable">actionable only</option>
              <option value="blocked">blocked only</option>
              <option value="unknown">unknown only</option>
            </select>
          </label>
        ) : null}
        {selectedCustomer ? (
          <button
            type="button"
            className="bone-chip-clear"
            onClick={() => setSelectedWorkspaceId(null)}
          >
            {selectedCustomer.name} ×
          </button>
        ) : null}
      </div>

      <div className="bone-columns">
        {/* One series, so the bars carry the brand hue and the value rides the tip. */}
        <section className="bone-panel">
          <div className="bone-panel-head">
            <h2>Largest culprits</h2>
            <span>
              flows parked in each customer&apos;s whole backlog · click a row to focus its reports
            </span>
          </div>
          {culprits.length === 0 ? (
            <p className="bone-empty">No customers match.</p>
          ) : (
            <ol className="bone-bars">
              {culprits.map((c) => {
                const width = maxFlows ? Math.max(4, (c.flowsInMaintenance / maxFlows) * 100) : 0;
                const active = c.workspaceId === selectedWorkspaceId;
                const blocked = culpritBlockedLabel(c, taskWolf);
                return (
                  <li key={c.workspaceId}>
                    <button
                      type="button"
                      className={`bone-bar-row ${active ? 'bone-bar-row--active' : ''}`}
                      onClick={() => setSelectedWorkspaceId(active ? null : c.workspaceId)}
                      aria-pressed={active}
                    >
                      <span className="bone-bar-head">
                        <span className="bone-bar-name" title={c.name}>
                          {c.name}
                        </span>
                        {c.isDemo ? <span className="bone-tag">demo</span> : null}
                      </span>
                      <span className="bone-bar-track">
                        <span className="bone-bar-fill" style={{ width: `${width}%` }} />
                        <span className="bone-bar-value">
                          {c.flowsInMaintenance}
                          {c.reportsTruncated ? '+' : ''}
                        </span>
                      </span>
                      <span className="bone-bar-meta">
                        {customerReportsLabel(c)} · oldest {c.oldestReportAgeDays} d
                        {blocked ? ` · ${blocked}` : ''}
                        {c.taskWolf?.assignees?.length
                          ? ` · QAE ${c.taskWolf.assignees.join(', ')}`
                          : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {customers.length > CULPRITS_PREVIEW ? (
            <button
              type="button"
              className="bone-link"
              onClick={() => setShowAllCulprits((v) => !v)}
            >
              {showAllCulprits
                ? 'Show fewer'
                : `Show all ${customers.length.toLocaleString()} customers`}
            </button>
          ) : null}
        </section>

        <section className="bone-panel bone-panel--wide">
          <div className="bone-panel-head">
            <h2>Longest outstanding</h2>
            <span>
              {reports.length.toLocaleString()} of{' '}
              {(snapshot?.reports || []).length.toLocaleString()} open reports
              {selectedCustomer ? ` · ${selectedCustomer.name}` : ''}
              {shownReports.length < reports.length
                ? ` · first ${shownReports.length.toLocaleString()} shown`
                : ''}
            </span>
          </div>
          <div className="bone-legend" aria-hidden="true">
            <span className="bone-legend-item bone-age--fresh">&lt; 30 d</span>
            <span className="bone-legend-item bone-age--aging">30–89 d</span>
            <span className="bone-legend-item bone-age--old">90–179 d</span>
            <span className="bone-legend-item bone-age--ancient">180 d +</span>
          </div>
          <div className="bone-table-wrap">
            <table className="bone-table">
              <thead>
                <tr>
                  <th className="bone-num">Age</th>
                  <th>Customer</th>
                  <th>Report</th>
                  <th className="bone-num">Flows</th>
                  {taskWolf?.enabled ? <th>Task Wolf</th> : null}
                  <th>Status</th>
                  <th className="bone-col-priority">Priority</th>
                  <th className="bone-col-opened">Opened</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={taskWolf?.enabled ? 8 : 7} className="bone-empty">
                      Nothing matches these filters.
                    </td>
                  </tr>
                ) : (
                  shownReports.map((r) => (
                    <ReportRow
                      key={r.issueId}
                      row={r}
                      showTaskWolf={Boolean(taskWolf?.enabled)}
                      askingTaskWolf={Boolean(taskWolf?.pending)}
                      onSelectCustomer={setSelectedWorkspaceId}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {reports.length > REPORTS_PREVIEW ? (
            <button
              type="button"
              className="bone-link"
              onClick={() => setExpandedReports(showAllReports ? null : reports)}
            >
              {showAllReports
                ? 'Show fewer'
                : `Show all ${reports.length.toLocaleString()} reports`}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default MaintenanceDashboard;
