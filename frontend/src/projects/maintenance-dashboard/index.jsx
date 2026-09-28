import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMaintenanceDashboard } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import {
  ageBucket,
  describeAge,
  downloadText,
  filterCustomers,
  filterReports,
  formatDate,
  formatDateTime,
  reportsToCsv,
  slackSummary,
  statusLabel,
  summarize,
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
 */

const POLL_MS = 4000;
const CULPRITS_PREVIEW = 15;

const TASK_WOLF_DOCS_URL = 'https://www.task-wolf.com/docs/users/automation/mcp/user-guide.html';
const TASK_WOLF_CONNECT_URL = 'https://www.task-wolf.com/settings/connect-claude';

function TaskWolfBadge({ row }) {
  const verdict = taskWolfVerdict(row);
  if (verdict === 'unknown') {
    return (
      <span
        className="bone-tw-badge bone-tw-badge--unknown"
        title="Task Wolf gave no blocked status that ties to this report"
      >
        —
      </span>
    );
  }
  if (verdict === 'blocked') {
    return (
      <span
        className="bone-tw-badge bone-tw-badge--blocked"
        title={row.taskWolf.blockerTitle || 'Blocked in Task Wolf'}
      >
        ⛔ Blocked
      </span>
    );
  }
  const partly = row.taskWolf.blockedFlows > 0;
  return (
    <span
      className="bone-tw-badge bone-tw-badge--actionable"
      title={
        partly
          ? `${row.taskWolf.blockedFlows} of ${row.flowCount} flows blocked`
          : 'No active blocker'
      }
    >
      ✓ Actionable
      {partly ? ` (${row.flowCount - row.taskWolf.blockedFlows} of ${row.flowCount})` : ''}
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
 * One line about the Task Wolf pass: how much of the backlog it covered, or
 * why it is missing. A stale token is the one failure an SE can fix alone,
 * so it says exactly where to go.
 */
function TaskWolfNotice({ taskWolf }) {
  if (!taskWolf) return null;
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
    return (
      <div className="bone-warning">
        Task Wolf could not be read ({taskWolf.error.code || 'error'}): {taskWolf.error.message}
      </div>
    );
  }
  const failed = taskWolf.errors?.length || 0;
  if (failed) {
    const first = taskWolf.errors[0];
    return (
      <div className="bone-warning">
        Task Wolf couldn&apos;t answer for {failed} {failed === 1 ? 'customer' : 'customers'}; their
        blocked status is unknown. First: {first.workspaceName}
        {first.tool ? ` (${first.tool})` : ''} — {first.message}
      </div>
    );
  }
  return null;
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

  const pollTimer = useRef(null);

  const load = useCallback(async ({ refresh = false } = {}) => {
    try {
      const next = await fetchMaintenanceDashboard({ refresh });
      setPayload(next);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load the maintenance backlog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep asking while a scan is running so the progress bar moves and the
  // fresh snapshot lands without a manual reload.
  const scanning = payload?.status === 'building' || payload?.refreshing;
  useEffect(() => {
    if (!scanning) return undefined;
    pollTimer.current = setTimeout(() => load(), POLL_MS);
    return () => clearTimeout(pollTimer.current);
  }, [scanning, payload, load]);

  const snapshot = payload?.status === 'ready' ? payload.snapshot : null;

  const customers = useMemo(
    () => filterCustomers(snapshot?.customers, { search, hideDemos, taskWolf: twFilter }),
    [snapshot, search, hideDemos, twFilter],
  );

  const reports = useMemo(
    () =>
      filterReports(snapshot?.reports, {
        search,
        hideDemos,
        minFlows,
        status,
        sortKey,
        taskWolf: twFilter,
        workspaceId: selectedWorkspaceId,
      }),
    [snapshot, search, hideDemos, minFlows, status, sortKey, twFilter, selectedWorkspaceId],
  );

  const totals = useMemo(() => summarize(reports, customers), [reports, customers]);

  const selectedCustomer = useMemo(
    () =>
      selectedWorkspaceId
        ? (snapshot?.customers || []).find((c) => c.workspaceId === selectedWorkspaceId)
        : null,
    [snapshot, selectedWorkspaceId],
  );

  const culprits = showAllCulprits ? customers : customers.slice(0, CULPRITS_PREVIEW);
  const maxFlows = customers.length ? customers[0].flowsInMaintenance : 0;

  const handleRescan = useCallback(() => {
    toast.info('Rescanning every workspace — this takes a few minutes.');
    load({ refresh: true });
  }, [load, toast]);

  const handleExport = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`maintenance-backlog-${stamp}.csv`, reportsToCsv(reports));
  }, [reports]);

  const handleCopySlack = useCallback(async () => {
    const text = slackSummary({ reports, customers, generatedAt: snapshot?.generatedAt });
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Slack summary copied.');
    } catch {
      toast.error('Could not copy to the clipboard — select the table and copy instead.');
    }
  }, [reports, customers, snapshot, toast]);

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
    return (
      <div className="bone-pile">
        <div className="bone-error">
          <h2>Couldn&apos;t read the maintenance backlog</h2>
          <p>{error}</p>
          <button type="button" className="bone-btn" onClick={() => load({ refresh: true })}>
            Try again
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
  const taskWolf = snapshot?.taskWolf || null;
  const taskWolfLabel = taskWolf?.enabled
    ? `Task Wolf: ${(taskWolf.customersAnswered || 0).toLocaleString()} of ${(
        taskWolf.customersQueried || 0
      ).toLocaleString()} customers answered`
    : 'Task Wolf: not connected';
  const hasTaskWolfData = Boolean(totals.withTaskWolf);
  const flowsSub = hasTaskWolfData
    ? `${totals.blockedFlows.toLocaleString()} blocked on the customer · ${totals.actionableFlows.toLocaleString()} actionable`
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
            disabled={Boolean(payload?.refreshing)}
          >
            {payload?.refreshing ? 'Rescanning…' : 'Rescan'}
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
        {payload?.refreshing ? <span className="bone-status-live">Rescanning…</span> : null}
      </div>

      {payload?.refreshing && payload?.progress ? (
        <ScanProgress progress={payload.progress} />
      ) : null}

      {error ? <div className="bone-warning">Last refresh failed: {error}</div> : null}

      {failedLabel ? (
        <div className="bone-warning">
          {failedLabel}
          {firstError ? ` First: ${firstError.workspaceName} — ${firstError.message}` : ''}
        </div>
      ) : null}

      <TaskWolfNotice taskWolf={taskWolf} />

      <section className="bone-tiles">
        <Tile label="Customers with backlog" value={totals.customers.toLocaleString()} />
        <Tile
          label="Open maintenance reports"
          value={totals.reports.toLocaleString()}
          sub={
            hasTaskWolfData
              ? `${totals.blockedReports.toLocaleString()} fully blocked · ${totals.withQae.toLocaleString()} with a QAE on it`
              : undefined
          }
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
        {taskWolf?.enabled ? (
          <label className="bone-select">
            Task Wolf
            <select value={twFilter} onChange={(e) => setTwFilter(e.target.value)}>
              <option value="all">all</option>
              <option value="actionable">actionable only</option>
              <option value="blocked">blocked only</option>
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
            <span>flows parked per customer · click a row to focus its reports</span>
          </div>
          {culprits.length === 0 ? (
            <p className="bone-empty">No customers match.</p>
          ) : (
            <ol className="bone-bars">
              {culprits.map((c) => {
                const width = maxFlows ? Math.max(4, (c.flowsInMaintenance / maxFlows) * 100) : 0;
                const active = c.workspaceId === selectedWorkspaceId;
                return (
                  <li key={c.workspaceId}>
                    <button
                      type="button"
                      className={`bone-bar-row ${active ? 'bone-bar-row--active' : ''}`}
                      onClick={() => setSelectedWorkspaceId(active ? null : c.workspaceId)}
                      aria-pressed={active}
                    >
                      <span className="bone-bar-name">
                        {c.name}
                        {c.isDemo ? <span className="bone-tag">demo</span> : null}
                      </span>
                      <span className="bone-bar-track">
                        <span className="bone-bar-fill" style={{ width: `${width}%` }} />
                        <span className="bone-bar-value">{c.flowsInMaintenance}</span>
                      </span>
                      <span className="bone-bar-meta">
                        {c.openReports} {c.openReports === 1 ? 'report' : 'reports'} · oldest{' '}
                        {c.oldestReportAgeDays} d
                        {c.taskWolf && c.taskWolf.blockedFlows > 0
                          ? ` · ${c.taskWolf.blockedFlows} blocked`
                          : ''}
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
                  <th>Priority</th>
                  <th>Opened</th>
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
                  reports.map((r) => (
                    <tr key={r.issueId} className={`bone-age--${ageBucket(r.ageDays)}`}>
                      <td className="bone-num">
                        <span className="bone-age-days">{r.ageDays.toLocaleString()} d</span>
                        <span className="bone-age-words">{describeAge(r.ageDays)}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="bone-customer"
                          onClick={() => setSelectedWorkspaceId(r.workspaceId)}
                        >
                          {r.workspaceName}
                        </button>
                        {r.isDemo ? <span className="bone-tag">demo</span> : null}
                      </td>
                      <td>
                        {r.url ? (
                          <a
                            className="bone-report"
                            href={r.url}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            #{r.number ?? '?'} {r.name}
                          </a>
                        ) : (
                          <span className="bone-report">
                            #{r.number ?? '?'} {r.name}
                          </span>
                        )}
                        {r.description ? (
                          <span className="bone-description">{r.description}</span>
                        ) : null}
                      </td>
                      <td className="bone-num">
                        {r.flowCount}
                        {r.healedFlowCount ? (
                          <span className="bone-healed" title="reproductions no longer active">
                            +{r.healedFlowCount} healed
                          </span>
                        ) : null}
                      </td>
                      {taskWolf?.enabled ? (
                        <td className="bone-tw">
                          <TaskWolfBadge row={r} />
                          {r.taskWolf?.assignees?.length ? (
                            <span className="bone-tw-qae" title="QAE with an open maintenance task">
                              QAE {r.taskWolf.assignees.join(', ')}
                            </span>
                          ) : null}
                          {taskWolfVerdict(r) === 'blocked' && r.taskWolf.blockerTitle ? (
                            <span className="bone-tw-blocker">{r.taskWolf.blockerTitle}</span>
                          ) : null}
                        </td>
                      ) : null}
                      <td>{statusLabel(r.status)}</td>
                      <td className="bone-priority">{r.priority}</td>
                      <td>{formatDate(r.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export default MaintenanceDashboard;
