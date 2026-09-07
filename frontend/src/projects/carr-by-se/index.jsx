import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCarrBySe, setCarrAttribution } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { summarizeRows, formatCurrency, formatCurrencyCompact } from './carrTotals';
import './CarrBySe.css';

/**
 * Spoils — CARR by SE.
 *
 * Every closed-won opportunity in QA Wolf's history, with a picker to record
 * which SE gets credit for it. Salesforce owns the opportunity facts; the only
 * thing this page writes is the SE on each row.
 *
 * All totals come from `summarizeRows` over the same `rows` in state that the
 * table renders, so a card can't drift from the rows beneath it. A picker
 * change updates that state immediately and the save goes out behind it --
 * assigning 399 rows is a long sitting, and waiting on a round-trip per row
 * would make it a much longer one.
 */

const SORTS = {
  closeDate: (a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''),
  opportunityName: (a, b) => a.opportunityName.localeCompare(b.opportunityName),
  fiscalPeriod: (a, b) => a.fiscalPeriod.localeCompare(b.fiscalPeriod),
  carrAmount: (a, b) => b.carrAmount - a.carrAmount,
  ownerName: (a, b) => a.ownerName.localeCompare(b.ownerName),
};

function SummaryCard({ label, value, sub, variant = '' }) {
  return (
    <div className={`carr-card ${variant ? `carr-card--${variant}` : ''}`}>
      <div className="carr-card-label">{label}</div>
      <div className="carr-card-value">{value}</div>
      {sub ? <div className="carr-card-sub">{sub}</div> : null}
    </div>
  );
}

function CarrBySe() {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [salesEngineers, setSalesEngineers] = useState([]);
  const [years, setYears] = useState([]);
  const [meta, setMeta] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [search, setSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [sortKey, setSortKey] = useState('carrAmount');
  const [savingIds, setSavingIds] = useState(() => new Set());

  const load = useCallback(async ({ refresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchCarrBySe({ refresh });
      setRows(payload.rows || []);
      setSalesEngineers(payload.salesEngineers || []);
      setYears(payload.years || []);
      setMeta({
        reportName: payload.reportName,
        reportId: payload.reportId,
        allData: payload.allData,
      });
      // Keep the year in view across a refresh; fall back to the newest.
      setSelectedYear((current) =>
        current && (payload.years || []).includes(current) ? current : (payload.years || [])[0],
      );
    } catch (err) {
      setError(err.message || 'Failed to load closed-won opportunities.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const allTime = useMemo(() => summarizeRows(rows, salesEngineers), [rows, salesEngineers]);

  const yearRows = useMemo(
    () => (selectedYear ? rows.filter((row) => row.fiscalYear === selectedYear) : rows),
    [rows, selectedYear],
  );

  const yearSummary = useMemo(
    () => summarizeRows(yearRows, salesEngineers),
    [yearRows, salesEngineers],
  );

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = yearRows.filter((row) => {
      if (unassignedOnly && row.salesEngineerId) return false;
      if (!needle) return true;
      return (
        row.opportunityName.toLowerCase().includes(needle) ||
        row.accountName.toLowerCase().includes(needle) ||
        row.ownerName.toLowerCase().includes(needle)
      );
    });
    return [...filtered].sort(SORTS[sortKey] || SORTS.carrAmount);
  }, [yearRows, search, unassignedOnly, sortKey]);

  const handleAssign = useCallback(
    async (row, nextSeId) => {
      const previous = row.salesEngineerId ?? null;
      const next = nextSeId || null;
      if (previous === next) return;

      // Optimistic: the picker is the whole interaction, so it has to feel
      // instant. A failed save puts the old value back and says so.
      setRows((current) =>
        current.map((r) =>
          r.opportunityId === row.opportunityId ? { ...r, salesEngineerId: next } : r,
        ),
      );
      setSavingIds((current) => new Set(current).add(row.opportunityId));

      try {
        await setCarrAttribution(row.opportunityId, next, row.opportunityName);
      } catch (err) {
        setRows((current) =>
          current.map((r) =>
            r.opportunityId === row.opportunityId ? { ...r, salesEngineerId: previous } : r,
          ),
        );
        toast.error(`Couldn't save "${row.opportunityName}": ${err.message}`);
      } finally {
        setSavingIds((current) => {
          const nextSet = new Set(current);
          nextSet.delete(row.opportunityId);
          return nextSet;
        });
      }
    },
    [toast],
  );

  if (loading) {
    return (
      <div className="carr-by-se">
        <div className="carr-loading">
          <div className="carr-spinner" />
          <h2>Loading closed-won history…</h2>
          <p>Reading the All Closed Won report from Salesforce</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="carr-by-se">
        <div className="carr-error">
          <h2>Couldn&apos;t load the report</h2>
          <p>{error}</p>
          <button type="button" className="carr-btn" onClick={() => load({ refresh: true })}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="carr-by-se">
      <header className="carr-header">
        <div>
          <div className="carr-overline">SPOILS</div>
          <h1>CARR by SE</h1>
          <p>
            Every closed-won opportunity in QA Wolf history. Pick the SE who gets credit — totals
            update as you go.
          </p>
        </div>
        <button type="button" className="carr-btn" onClick={() => load({ refresh: true })}>
          Refresh from Salesforce
        </button>
      </header>

      {/*
        The report is capped at 2000 detail rows by the Analytics API. If it
        ever exceeds that, every total on this page is quietly short, so say so
        rather than letting a wrong number look authoritative.
      */}
      {meta && meta.allData === false && (
        <div className="carr-warning">
          Salesforce truncated this report, so these totals are incomplete. The All Closed Won
          report has passed the 2000-row limit of a synchronous report run.
        </div>
      )}

      {/* All-time strip — always visible, independent of the year in view. */}
      <section className="carr-alltime">
        <div className="carr-alltime-head">
          <h2>All time</h2>
          <span className="carr-alltime-range">
            {years.length ? `${years[years.length - 1]}–${years[0]}` : '—'} · {allTime.oppCount}{' '}
            opps · {formatCurrency(allTime.totalCarr)} total CARR
          </span>
        </div>
        <div className="carr-alltime-chips">
          {allTime.bySe.map((se) => (
            <div key={se.id} className={`carr-chip ${se.carr === 0 ? 'carr-chip--empty' : ''}`}>
              <span className="carr-chip-name">{se.name}</span>
              <span className="carr-chip-value">{formatCurrencyCompact(se.carr)}</span>
              <span className="carr-chip-count">{se.count}</span>
            </div>
          ))}
          <div className="carr-chip carr-chip--total">
            <span className="carr-chip-name">Attributed</span>
            <span className="carr-chip-value">{formatCurrencyCompact(allTime.attributedCarr)}</span>
            <span className="carr-chip-count">{allTime.attributedCount}</span>
          </div>
          <div className="carr-chip carr-chip--muted">
            <span className="carr-chip-name">Unassigned</span>
            <span className="carr-chip-value">
              {formatCurrencyCompact(allTime.unattributedCarr)}
            </span>
            <span className="carr-chip-count">{allTime.unattributedCount}</span>
          </div>
        </div>
      </section>

      {/* Year selector */}
      <nav className="carr-years" aria-label="Fiscal year">
        {years.map((year) => (
          <button
            key={year}
            type="button"
            className={`carr-year ${year === selectedYear ? 'carr-year--active' : ''}`}
            onClick={() => setSelectedYear(year)}
          >
            {year}
          </button>
        ))}
      </nav>

      {/* Per-SE cards for the selected year */}
      <section className="carr-cards">
        {yearSummary.bySe.map((se) => (
          <SummaryCard
            key={se.id}
            label={se.name}
            value={formatCurrency(se.carr)}
            sub={`${se.count} ${se.count === 1 ? 'opp' : 'opps'}`}
            variant={se.carr === 0 ? 'empty' : ''}
          />
        ))}
        <SummaryCard
          label={`Total · ${selectedYear || 'all'}`}
          value={formatCurrency(yearSummary.attributedCarr)}
          sub={`${yearSummary.attributedCount} of ${yearSummary.oppCount} opps attributed`}
          variant="total"
        />
        <SummaryCard
          label="Unassigned"
          value={formatCurrency(yearSummary.unattributedCarr)}
          sub={`${yearSummary.unattributedCount} ${
            yearSummary.unattributedCount === 1 ? 'opp' : 'opps'
          } with no SE`}
          variant="muted"
        />
      </section>

      {/* Filters */}
      <div className="carr-toolbar">
        <input
          type="search"
          className="carr-search"
          placeholder="Filter by opportunity, account, or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="carr-checkbox">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => setUnassignedOnly(e.target.checked)}
          />
          Unassigned only
        </label>
        <label className="carr-sort">
          Sort
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="carrAmount">CARR (high to low)</option>
            <option value="closeDate">Close date (newest)</option>
            <option value="opportunityName">Opportunity name</option>
            <option value="fiscalPeriod">Fiscal period</option>
            <option value="ownerName">Opportunity owner</option>
          </select>
        </label>
        <span className="carr-rowcount">
          {visibleRows.length} of {yearRows.length} rows
        </span>
      </div>

      {/* Table */}
      <div className="carr-table-wrap">
        <table className="carr-table">
          <thead>
            <tr>
              <th>Opportunity</th>
              <th>Fiscal Period</th>
              <th className="carr-num">CARR</th>
              <th>Opportunity Owner</th>
              <th>Sales Engineer</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.opportunityId}
                className={row.salesEngineerId ? 'carr-row--assigned' : ''}
              >
                <td>
                  <span className="carr-opp-name">{row.opportunityName}</span>
                  {row.accountName && row.accountName !== row.opportunityName ? (
                    <span className="carr-opp-account">{row.accountName}</span>
                  ) : null}
                </td>
                <td>{row.fiscalPeriod}</td>
                <td className="carr-num carr-amount">{formatCurrency(row.carrAmount)}</td>
                <td>{row.ownerName}</td>
                <td>
                  <select
                    className={`carr-select ${row.salesEngineerId ? 'carr-select--set' : ''}`}
                    value={row.salesEngineerId || ''}
                    disabled={savingIds.has(row.opportunityId)}
                    onChange={(e) => handleAssign(row, e.target.value)}
                    aria-label={`Sales engineer for ${row.opportunityName}`}
                  >
                    <option value="">None</option>
                    {salesEngineers.map((se) => (
                      <option key={se.id} value={se.id}>
                        {se.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={5} className="carr-empty">
                  No opportunities match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CarrBySe;
