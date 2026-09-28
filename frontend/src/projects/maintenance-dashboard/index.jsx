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
 * The scan behind the snapshot is slow (one QA Wolf call per workspace), so
 * the page never waits on it: a fresh snapshot answers instantly, a stale one
 * answers while a rebuild runs, and the first-ever load shows progress.
 */

const POLL_MS = 4000;
const CULPRITS_PREVIEW = 15;

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
  return (
    <div className="bone-progress" role="status" aria-live="polite">
      <div className="bone-progress-track">
        <div className="bone-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="bone-progress-text">
        {total
          ? `Scanning workspace ${scanned.toLocaleString()} of ${total.toLocaleString()}…`
          : 'Listing workspaces…'}
        {progress?.failed ? ` (${progress.failed} failed so far)` : ''}
      </div>
    </div>
  );
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
    () => filterCustomers(snapshot?.customers, { search, hideDemos }),
    [snapshot, search, hideDemos],
  );

  const reports = useMemo(
    () =>
      filterReports(snapshot?.reports, {
        search,
        hideDemos,
        minFlows,
        status,
        sortKey,
        workspaceId: selectedWorkspaceId,
      }),
    [snapshot, search, hideDemos, minFlows, status, sortKey, selectedWorkspaceId],
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

  return (
    <div className="bone-pile">
      <header className="bone-header">
        <div>
          <div className="bone-overline">BONE PILE</div>
          <h1>Maintenance backlog</h1>
          <p>
            Every open maintenance report across QA Wolf, ranked by how long it has been sitting
            and by how many tests each customer has parked. Pick a bone, tell the team, gnaw.
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

      <section className="bone-tiles">
        <Tile label="Customers with backlog" value={totals.customers.toLocaleString()} />
        <Tile label="Open maintenance reports" value={totals.reports.toLocaleString()} />
        <Tile
          label="Flows parked"
          value={totals.flows.toLocaleString()}
          sub="distinct tests out of the suite"
        />
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
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="bone-empty">
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
