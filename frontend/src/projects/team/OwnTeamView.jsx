import React, { useEffect, useMemo, useState } from 'react';
import {
  LuChartBar,
  LuClipboardCheck,
  LuFilePen,
  LuHammer,
  LuSparkles,
  LuTrendingUp,
  LuTrophy,
} from 'react-icons/lu';
import {
  fetchDashboardLinearClosed,
  fetchSalesforceReport,
  fetchSalesforceSnapshotMetrics,
  getSalesforceConfig,
} from '../../services/api';
import './team.less';

// We share localStorage keys with `<CurrentQuarterMetrics />` on purpose —
// when the SE has already loaded The Den, the team page hydrates from
// the warm cache instead of waiting on a fresh Salesforce round-trip,
// and vice versa.
const CONFIG_CACHE_KEY = 'currentQuarterMetrics.config';
const DATA_CACHE_KEY = 'currentQuarterMetrics.dataByYear';

// Resolve the year whose metrics report we should pull. Mirrors the same
// logic CurrentQuarterMetrics uses: prefer the current calendar year if
// it has data, otherwise fall back to the most recent configured year
// that has either a snapshot or a live report ID.
function resolveDataYear(config) {
  const calendarYear = new Date().getFullYear();
  if (!config) return calendarYear;
  const hasData = (yr) =>
    (config.snapshotYears || []).includes(yr) || !!config.reportIdsByYear?.[yr]?.metrics;
  if (hasData(calendarYear)) return calendarYear;
  const allYears = [
    ...new Set([
      ...Object.keys(config.reportIdsByYear || {}).map(Number),
      ...(config.snapshotYears || []),
    ]),
  ].sort((a, b) => b - a);
  return allYears.find(hasData) ?? calendarYear;
}

function readCachedConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readCachedData(year) {
  try {
    const raw = localStorage.getItem(DATA_CACHE_KEY);
    if (!raw) return null;
    const byYear = JSON.parse(raw);
    return byYear?.[year] ?? null;
  } catch {
    return null;
  }
}

function writeCachedData(year, payload) {
  try {
    const raw = localStorage.getItem(DATA_CACHE_KEY);
    const byYear = raw ? JSON.parse(raw) : {};
    byYear[year] = payload;
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(byYear));
  } catch {
    // ignore quota / serialization issues — cache is best-effort
  }
}

function normalizeName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

// Decide whether an opp counts as a "C-scored" deal that should be
// excluded from CARR goal math. We key off **Account Score** rather
// than Sales Score because ICP signals (AAR, geo, engineer count,
// etc.) can promote an opp from Sales=C to Account=E — those E deals
// should still count toward the goal. Empty `accountScore` (legacy
// 2025 reports + pre-2026 snapshots) returns false, which keeps
// historical years' totals identical to what they were before this
// feature shipped.
function isCScore(opp) {
  const raw = (opp?.accountScore || '').trim().toUpperCase();
  return raw === 'C' || raw.startsWith('C ') || raw.startsWith('C-');
}

/**
 * Walk every closed-won opp in the metrics payload and bucket them by
 * AE name (case-insensitive, whitespace-trimmed — same comparison the
 * backend uses in `userMetricsFilter.js` for SE-scoped views), routing
 * C-scored deals into a separate map so the team page can show them
 * under their own panel without polluting the goal-eligible totals.
 *
 * Returns `{ goalEligibleByAE, cScoreByAE }`, each Map<aeKey, Opp[]>
 * sorted by effective date desc (most recent close first).
 */
function groupOppsByAE(data) {
  const goalEligibleByAE = new Map();
  const cScoreByAE = new Map();
  if (!data) return { goalEligibleByAE, cScoreByAE };
  // Prefer the flat list when present; the per-quarter buckets are the
  // same source of truth either way.
  const opps = Array.isArray(data.allOpportunities)
    ? data.allOpportunities
    : Object.entries(data.quarterlyData || {})
        .filter(([key]) => key !== 'Total')
        .flatMap(([, q]) => q?.opportunities ?? []);

  for (const opp of opps) {
    const key = normalizeName(opp.aeName);
    if (!key) continue;
    const target = isCScore(opp) ? cScoreByAE : goalEligibleByAE;
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(opp);
  }

  const sortByDateDesc = (a, b) => {
    const da = a.effectiveDate ? Date.parse(a.effectiveDate) : 0;
    const db = b.effectiveDate ? Date.parse(b.effectiveDate) : 0;
    return db - da;
  };
  for (const list of goalEligibleByAE.values()) list.sort(sortByDateDesc);
  for (const list of cScoreByAE.values()) list.sort(sortByDateDesc);

  return { goalEligibleByAE, cScoreByAE };
}

// Format a CARR amount as "$48,000" with no decimals — matches the
// home-page metric tiles' compact treatment instead of the report's
// raw "$48,000.00" string. Falls back to the formatted label from
// the report when the numeric amount is missing.
function formatCarr(opp) {
  const amount = Number(opp?.carrAmount);
  if (Number.isFinite(amount) && amount > 0) {
    return `$${Math.round(amount).toLocaleString('en-US')}`;
  }
  return opp?.carrAmountFormatted || '—';
}

// Sum the numeric CARR for a list of opps. Skips rows whose carrAmount
// is missing or non-numeric instead of poisoning the total with NaN.
function sumCarr(opps) {
  return opps.reduce((sum, opp) => {
    const amount = Number(opp?.carrAmount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
}

function formatTotalCarr(amount) {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

// Compact currency for the at-a-glance summary tiles — matches the
// home-page `CurrentQuarterMetrics` widget's formatting so the team
// page's tiles read identically ($1.21M / $151K / $48,000).
function formatCompactCurrency(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return '$0';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

// Build the report's quarter key for "right now" — e.g. "Q2 CY2026".
// Mirrors the format the metrics report uses internally so we can
// filter `opp.quarter` directly without any further normalization.
function getCurrentQuarterKey() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${quarter} CY${year}`;
}

// Just the quarter number (1..4) for the current calendar month —
// used to pick the default tab on the Monthly Breakdown section so
// the SE lands on whichever quarter they're actively living in.
function getCurrentQuarterNumber() {
  const month = new Date().getMonth() + 1;
  return month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
}

// Short label rendered next to the "Current Quarter" filter pill —
// makes it obvious *which* quarter is being shown without forcing
// the user to do calendar math.
function getCurrentQuarterShortLabel() {
  const key = getCurrentQuarterKey();
  // "Q2 CY2026" → "Q2 2026"
  return key.replace(/\s+CY/, ' ');
}

const SCOPE_YEAR = 'year';
const SCOPE_QUARTER = 'quarter';

// Primary view toggle values. Kept as constants so the React state
// initial value, the toggle handler, and the conditional render
// branches all reference the same string instead of stringly-typed
// magic literals scattered through the JSX.
const VIEW_TEAM = 'team';
const VIEW_YOU = 'you';

// Category roster for the You-view monthly chart. One line per
// entry; each entry drives both the line/dot color (via the
// `--{key}` modifier in the LESS) and the legend pill. Order is
// stable across renders so legend ordering matches what the eye
// scans across the chart.
const CHART_CATEGORIES = [
  { key: 'creation', label: 'Creation' },
  { key: 'estimation', label: 'Estimation' },
  { key: 'aiDemo', label: 'AI Demo' },
  { key: 'other', label: 'Other' },
];

// Chart geometry. ViewBox is fixed in user-space units (CSS scales
// the SVG to fill its container while preserving aspect ratio), so
// any tweaks here automatically reflow without touching the JSX.
const CHART_VIEWBOX_W = 720;
const CHART_VIEWBOX_H = 280;
const CHART_PAD = { top: 20, right: 24, bottom: 40, left: 44 };

// Round the data max up to a "nice" y-axis ceiling so tick marks
// land on whole numbers (5/10/20/…) rather than on awkward
// fractions like 9 or 13. Floors at 5 so a quarter with a single
// ticket still has room above the dot to breathe.
function niceChartMax(value) {
  const v = Math.max(1, Math.ceil(value));
  if (v <= 5) return 5;
  if (v <= 10) return 10;
  if (v <= 20) return 20;
  if (v <= 50) return Math.ceil(v / 10) * 10;
  if (v <= 100) return Math.ceil(v / 20) * 20;
  return Math.ceil(v / 50) * 50;
}

// Build the {0, 25%, 50%, 75%, 100%} ladder of y-axis values, but
// snapped to integers when the ceiling is small enough that
// fractional gridlines would look weird.
function buildYTicks(yMax) {
  if (yMax <= 5) {
    return Array.from({ length: yMax + 1 }, (_, i) => i);
  }
  if (yMax <= 10) {
    return [0, 2, 4, 6, 8, 10].filter((v) => v <= yMax);
  }
  return [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(p * yMax));
}

// Pretty-format an average lead time (days) for the ticket tile hint.
// Adapts the unit to the magnitude so a "0.04 days" doesn't render as
// the meaningless "0.0 days" — sub-day averages flip to hours, and
// large averages drop the decimal so the caption stays compact.
function formatAvgLeadTime(days) {
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 1) {
    const hours = days * 24;
    if (hours < 1) return 'avg < 1h to close';
    return `avg ${Math.round(hours)}h to close`;
  }
  if (days < 10) return `avg ${days.toFixed(1)} days to close`;
  return `avg ${Math.round(days)} days to close`;
}

/**
 * OwnTeamView — the per-SE team page body for regular SEs (non-leads).
 *
 * Scope is intentionally "own team only": each SE only ever sees their own
 * team's page. Rendered by `TeamPage` (which owns the hero + slug handling)
 * whenever the viewer is not an SE lead.
 *
 * A "Team" / "You" toggle switches between two section sets:
 *   • Team — Salesforce closed-won roll-up ("At a glance") plus a per-AE
 *     "CARR broken down by AE" breakdown, scoped to the viewer's own team.
 *   • You  — the viewer's personal Linear "Tickets closed by you" tiles and a
 *     "Monthly breakdown" chart.
 * A separate year / current-quarter scope pill rescopes whichever view is on.
 */
function OwnTeamView({ team, user }) {
  // First-name only for the personalized "Tickets closed by you" copy.
  // Falls back to empty string so the subtitle reads naturally
  // ("Linear tickets you've completed…") when we can't resolve a name.
  const firstName = useMemo(() => {
    const raw = (user?.firstName || '').trim();
    return raw;
  }, [user?.firstName]);

  // Salesforce metrics state. Reads from the shared localStorage cache
  // first so the page paints instantly when the SE has already hit
  // The Den, then refreshes in the background.
  const [config, setConfig] = useState(readCachedConfig);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Year / Current-Quarter scope filter. Default to year so the page
  // matches what a fresh visitor saw before the filter was added; the
  // filter narrows down rather than expanding away from a default.
  const [scope, setScope] = useState(SCOPE_YEAR);

  // Primary view toggle: "team" shows the SF roll-up + AE breakdown,
  // "you" shows the personal Linear tickets section.
  const [view, setView] = useState(VIEW_TEAM);

  // Selected quarter for the You-view "Monthly breakdown" section.
  // Independent of the year/quarter filter pill — the filter pill
  // rescopes the topline tiles, while this picks which quarter the
  // chart below renders. Defaults to whichever quarter contains today.
  const [selectedQuarter, setSelectedQuarter] = useState(getCurrentQuarterNumber);

  // Personal Linear roll-up (tickets THIS user has closed). Independent
  // of the Salesforce metrics fetch but driven by the same `scope` so
  // toggling the filter pill rescopes both halves of the page in lock-step.
  const [linearClosed, setLinearClosed] = useState(null);
  const [linearError, setLinearError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLinearError(null);
    fetchDashboardLinearClosed()
      .then((payload) => {
        if (cancelled) return;
        setLinearClosed(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setLinearError(err?.message || 'Failed to load Linear tickets');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the same year / current-quarter scope to the Linear roll-up
  // that we apply to the SF roster, so the page tells one coherent
  // story under whichever filter is active.
  const closedTicketsScoped = useMemo(() => {
    if (!linearClosed?.configured) return null;
    if (scope === SCOPE_QUARTER) {
      const currentKey = getCurrentQuarterKey();
      return (
        linearClosed.byQuarter?.[currentKey] ?? {
          estimation: 0,
          creation: 0,
          aiDemo: 0,
          other: 0,
          total: 0,
        }
      );
    }
    return linearClosed.total;
  }, [linearClosed, scope]);

  // Quarter bucket the Monthly Breakdown chart is currently rendering.
  // Decoupled from the filter pill — that pill rescopes the topline
  // tiles, while this section has its own quarter tab strip below.
  const selectedQuarterBucket = useMemo(() => {
    if (!linearClosed?.configured) return null;
    const year = linearClosed.year;
    const key = `Q${selectedQuarter} CY${year}`;
    return linearClosed.byQuarter?.[key] ?? null;
  }, [linearClosed, selectedQuarter]);

  const currentYear = useMemo(() => resolveDataYear(config), [config]);

  // Hydrate `data` from cache the moment we know which year to read,
  // so the first paint already shows opps if the user just came from
  // The Den (which writes the same cache key).
  useEffect(() => {
    const cached = readCachedData(currentYear);
    if (cached) {
      setData(cached);
      setLoading(false);
    }
  }, [currentYear]);

  // Refresh config in the background. Same pattern as
  // CurrentQuarterMetrics — silent failures, best-effort cache write.
  useEffect(() => {
    let cancelled = false;
    getSalesforceConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        try {
          localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(c));
        } catch {
          // ignore cache write issues
        }
      })
      .catch(() => {
        if (!cancelled && !readCachedConfig()) {
          setError('Failed to load Salesforce config');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch (or refresh) the metrics report for the resolved year. Falls
  // back to the live report endpoint when the year isn't snapshotted.
  useEffect(() => {
    if (!config) return undefined;
    const isSnapshotYear = (config.snapshotYears || []).includes(currentYear);
    const reportId = config.reportIdsByYear?.[currentYear]?.metrics;
    if (!isSnapshotYear && !reportId) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchMetrics = () => {
      if (isSnapshotYear) {
        return fetchSalesforceSnapshotMetrics(currentYear).catch(() => {
          if (reportId) return fetchSalesforceReport(reportId);
          throw new Error('Snapshot unavailable and no report ID for this year');
        });
      }
      return fetchSalesforceReport(reportId);
    };

    fetchMetrics()
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setError(null);
        writeCachedData(currentYear, response);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config, currentYear]);

  // Split the closed-won opps into goal-eligible (drives "At a glance" +
  // "CARR broken down by AE") and C-scored (drives the "Closed-won C opps"
  // table), so C deals are tracked for visibility without inflating the
  // goal numbers above.
  const { goalEligibleByAE, cScoreByAE } = useMemo(() => groupOppsByAE(data), [data]);

  // Scope helper — pass-through for the full year; filter each AE's list
  // to opps whose `quarter` matches today's key (e.g. "Q2 CY2026") when
  // the current-quarter pill is active so totals + rows stay in sync.
  const scopeByAE = (map) => {
    if (scope === SCOPE_YEAR) return map;
    const currentKey = getCurrentQuarterKey();
    const next = new Map();
    for (const [aeKey, opps] of map.entries()) {
      next.set(
        aeKey,
        opps.filter((opp) => opp.quarter === currentKey),
      );
    }
    return next;
  };

  const filteredOppsByAE = useMemo(() => scopeByAE(goalEligibleByAE), [goalEligibleByAE, scope]);
  const filteredCOppsByAE = useMemo(() => scopeByAE(cScoreByAE), [cScoreByAE, scope]);

  // Roll up team-wide stats from the same filtered map that drives the
  // AE roster, restricted to the team's own AE roster so the at-a-glance
  // tiles and the per-AE cards always tell a consistent story (sum of AE
  // totals === team total, etc.).
  const teamTotals = useMemo(() => {
    const teamAEs = team?.accountExecutives ?? [];
    let totalCarr = 0;
    let count = 0;
    for (const ae of teamAEs) {
      const opps = filteredOppsByAE.get(normalizeName(ae.name)) ?? [];
      for (const opp of opps) {
        const amount = Number(opp?.carrAmount);
        if (Number.isFinite(amount)) totalCarr += amount;
        count += 1;
      }
    }
    return {
      totalCarr,
      count,
      avgDealSize: count > 0 ? totalCarr / count : 0,
    };
  }, [filteredOppsByAE, team?.accountExecutives]);

  // Same roll-up shape, restricted to C-scored opps for the team's own
  // AEs. Drives the C-section subtitle and its empty-state branch.
  const cTeamTotals = useMemo(() => {
    const teamAEs = team?.accountExecutives ?? [];
    let totalCarr = 0;
    let count = 0;
    for (const ae of teamAEs) {
      const opps = filteredCOppsByAE.get(normalizeName(ae.name)) ?? [];
      for (const opp of opps) {
        const amount = Number(opp?.carrAmount);
        if (Number.isFinite(amount)) totalCarr += amount;
        count += 1;
      }
    }
    return { totalCarr, count };
  }, [filteredCOppsByAE, team?.accountExecutives]);

  // Flat list of C opps for the team's own AEs, sorted by close date desc
  // (most recent first). Each row carries `aeName` so the table renders
  // Opp / AE / CARR side-by-side without walking the per-AE map again.
  const cOppsForTeam = useMemo(() => {
    const teamAEs = team?.accountExecutives ?? [];
    const rows = [];
    for (const ae of teamAEs) {
      const opps = filteredCOppsByAE.get(normalizeName(ae.name)) ?? [];
      for (const opp of opps) rows.push({ opp, aeName: ae.name });
    }
    rows.sort((a, b) => {
      const da = a.opp.effectiveDate ? Date.parse(a.opp.effectiveDate) : 0;
      const db = b.opp.effectiveDate ? Date.parse(b.opp.effectiveDate) : 0;
      return db - da;
    });
    return rows;
  }, [filteredCOppsByAE, team?.accountExecutives]);

  const aes = team.accountExecutives ?? [];

  if (aes.length === 0) {
    return (
      <p className="page-header__sub">
        No active AEs on this team yet. Ask an admin to add one in the Alpha Pack.
      </p>
    );
  }

  return (
    <div className="team-page__body">
      {/*
        Page-level controls bar. Two segmented toggles share a row:
          • "View" picks the section set below (Team vs You).
          • "Scope" rescopes whichever sections are showing.
      */}
      <div className="team-page__controls">
        <div
          className="team-page__filter team-page__filter--view"
          role="tablist"
          aria-label="Switch between team and personal view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === VIEW_TEAM}
            className={`team-page__filter-btn ${view === VIEW_TEAM ? 'is-active' : ''}`}
            onClick={() => setView(VIEW_TEAM)}
          >
            Team
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === VIEW_YOU}
            className={`team-page__filter-btn ${view === VIEW_YOU ? 'is-active' : ''}`}
            onClick={() => setView(VIEW_YOU)}
          >
            You
          </button>
        </div>
        <div
          className="team-page__filter"
          role="tablist"
          aria-label="Scope metrics by year or current quarter"
        >
          <button
            type="button"
            role="tab"
            aria-selected={scope === SCOPE_YEAR}
            className={`team-page__filter-btn ${scope === SCOPE_YEAR ? 'is-active' : ''}`}
            onClick={() => setScope(SCOPE_YEAR)}
          >
            For the Year
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === SCOPE_QUARTER}
            className={`team-page__filter-btn ${scope === SCOPE_QUARTER ? 'is-active' : ''}`}
            onClick={() => setScope(SCOPE_QUARTER)}
            title={`Current quarter: ${getCurrentQuarterShortLabel()}`}
          >
            Current Quarter
          </button>
        </div>
      </div>

      {/*
        "Tickets closed by you" — personal Linear roll-up. Only renders in
        the You view. The fragment wraps two sibling sections (tickets tiles
        + monthly breakdown chart) under the same view gate.
      */}
      {view === VIEW_YOU && (
        <>
          <section className="team-page__section">
            <div className="team-page__section-header">
              <div className="team-page__section-heading">
                <h2 className="team-page__section-title">Tickets closed by you</h2>
                <p className="team-page__section-subtitle">
                  {(() => {
                    const subject = firstName ? `${firstName} has` : "you've";
                    const window =
                      scope === SCOPE_QUARTER
                        ? `this quarter (${getCurrentQuarterShortLabel()})`
                        : 'this year';
                    return `Linear tickets ${subject} completed ${window}.`;
                  })()}
                </p>
              </div>
            </div>
            {linearClosed?.needsLinearProfile ? (
              <p className="team-page__linear-hint">
                We couldn&apos;t match your account to a Linear user yet. Check your Profile so we
                can pull in your closed tickets.
              </p>
            ) : linearError || linearClosed?.error === 'linear_unavailable' ? (
              <p className="team-page__linear-hint">
                Couldn&apos;t load your closed tickets right now. Try refreshing in a minute.
              </p>
            ) : (
              <div className="team-page__totals" style={{ '--tile-cols': 4 }}>
                <article className="metric-summary metric-summary--detailed">
                  <div className="metric-summary__head">
                    <span className="metric-summary__label">Tickets Closed</span>
                    <span className="metric-summary__icon" aria-hidden="true">
                      <LuClipboardCheck />
                    </span>
                  </div>
                  <div className="metric-summary__value">
                    {closedTicketsScoped ? closedTicketsScoped.total.toLocaleString('en-US') : '—'}
                  </div>
                  {closedTicketsScoped && formatAvgLeadTime(closedTicketsScoped.avgDaysTotal) && (
                    <div className="metric-summary__foot">
                      <span className="metric-summary__hint">
                        {formatAvgLeadTime(closedTicketsScoped.avgDaysTotal)}
                      </span>
                    </div>
                  )}
                </article>

                <article className="metric-summary metric-summary--detailed">
                  <div className="metric-summary__head">
                    <span className="metric-summary__label">Estimation</span>
                    <span className="metric-summary__icon" aria-hidden="true">
                      <LuFilePen />
                    </span>
                  </div>
                  <div className="metric-summary__value">
                    {closedTicketsScoped
                      ? closedTicketsScoped.estimation.toLocaleString('en-US')
                      : '—'}
                  </div>
                  {closedTicketsScoped &&
                    formatAvgLeadTime(closedTicketsScoped.avgDaysEstimation) && (
                      <div className="metric-summary__foot">
                        <span className="metric-summary__hint">
                          {formatAvgLeadTime(closedTicketsScoped.avgDaysEstimation)}
                        </span>
                      </div>
                    )}
                </article>

                <article className="metric-summary metric-summary--detailed">
                  <div className="metric-summary__head">
                    <span className="metric-summary__label">Creation</span>
                    <span className="metric-summary__icon" aria-hidden="true">
                      <LuHammer />
                    </span>
                  </div>
                  <div className="metric-summary__value">
                    {closedTicketsScoped
                      ? closedTicketsScoped.creation.toLocaleString('en-US')
                      : '—'}
                  </div>
                  {closedTicketsScoped &&
                    formatAvgLeadTime(closedTicketsScoped.avgDaysCreation) && (
                      <div className="metric-summary__foot">
                        <span className="metric-summary__hint">
                          {formatAvgLeadTime(closedTicketsScoped.avgDaysCreation)}
                        </span>
                      </div>
                    )}
                </article>

                <article className="metric-summary metric-summary--detailed">
                  <div className="metric-summary__head">
                    <span className="metric-summary__label">AI Demo</span>
                    <span className="metric-summary__icon" aria-hidden="true">
                      <LuSparkles />
                    </span>
                  </div>
                  <div className="metric-summary__value">
                    {closedTicketsScoped
                      ? (closedTicketsScoped.aiDemo ?? 0).toLocaleString('en-US')
                      : '—'}
                  </div>
                  {closedTicketsScoped && formatAvgLeadTime(closedTicketsScoped.avgDaysAiDemo) && (
                    <div className="metric-summary__foot">
                      <span className="metric-summary__hint">
                        {formatAvgLeadTime(closedTicketsScoped.avgDaysAiDemo)}
                      </span>
                    </div>
                  )}
                </article>
              </div>
            )}
          </section>

          {/*
            Monthly breakdown — second section in the You view. A quarter-tab
            strip across the top picks which quarter the chart renders.
          */}
          {linearClosed?.configured && (
            <section className="team-page__section">
              <div className="team-page__section-header">
                <div className="team-page__section-heading">
                  <h2 className="team-page__section-title">Monthly breakdown</h2>
                  <p className="team-page__section-subtitle">
                    Tickets you closed each month of Q{selectedQuarter} {linearClosed.year}.
                  </p>
                </div>
                <div
                  className="team-page__filter team-page__filter--quarters"
                  role="tablist"
                  aria-label="Pick a quarter"
                >
                  {[1, 2, 3, 4].map((q) => (
                    <button
                      key={q}
                      type="button"
                      role="tab"
                      aria-selected={selectedQuarter === q}
                      className={`team-page__filter-btn ${selectedQuarter === q ? 'is-active' : ''}`}
                      onClick={() => setSelectedQuarter(q)}
                    >
                      Q{q}
                    </button>
                  ))}
                </div>
              </div>
              {selectedQuarterBucket ? (
                selectedQuarterBucket.total === 0 ? (
                  <p className="team-page__linear-hint">
                    No tickets closed in Q{selectedQuarter} {linearClosed.year} yet.
                  </p>
                ) : (
                  (() => {
                    const months = selectedQuarterBucket.byMonth || [];
                    const dataMax = Math.max(
                      1,
                      ...months.flatMap((m) => CHART_CATEGORIES.map((c) => m[c.key] || 0)),
                    );
                    const yMax = niceChartMax(dataMax);
                    const yTicks = buildYTicks(yMax);

                    const plotW = CHART_VIEWBOX_W - CHART_PAD.left - CHART_PAD.right;
                    const plotH = CHART_VIEWBOX_H - CHART_PAD.top - CHART_PAD.bottom;
                    const xOf = (i) =>
                      months.length === 1
                        ? CHART_PAD.left + plotW / 2
                        : CHART_PAD.left + (i / (months.length - 1)) * plotW;
                    const yOf = (v) => CHART_PAD.top + plotH - (v / yMax) * plotH;

                    return (
                      <>
                        <div
                          className="team-page__chart"
                          role="img"
                          aria-label={`Monthly closed tickets for Q${selectedQuarter} ${linearClosed.year}, with one line per ticket type`}
                        >
                          <svg
                            className="team-page__chart-svg"
                            viewBox={`0 0 ${CHART_VIEWBOX_W} ${CHART_VIEWBOX_H}`}
                            preserveAspectRatio="xMidYMid meet"
                            role="presentation"
                          >
                            {yTicks.map((tick) => (
                              <g key={`y-${tick}`}>
                                <line
                                  className="team-page__chart-grid"
                                  x1={CHART_PAD.left}
                                  y1={yOf(tick)}
                                  x2={CHART_VIEWBOX_W - CHART_PAD.right}
                                  y2={yOf(tick)}
                                />
                                <text
                                  className="team-page__chart-axis"
                                  x={CHART_PAD.left - 8}
                                  y={yOf(tick)}
                                  textAnchor="end"
                                  dominantBaseline="middle"
                                >
                                  {tick}
                                </text>
                              </g>
                            ))}

                            {months.map((m, i) => (
                              <text
                                key={`x-${m.month}`}
                                className="team-page__chart-axis team-page__chart-axis--x"
                                x={xOf(i)}
                                y={CHART_VIEWBOX_H - CHART_PAD.bottom + 22}
                                textAnchor="middle"
                              >
                                {m.label}
                              </text>
                            ))}

                            {CHART_CATEGORIES.map((cat) => {
                              const points = months
                                .map((m, i) => `${xOf(i)},${yOf(m[cat.key] || 0)}`)
                                .join(' ');
                              const catTotal = selectedQuarterBucket?.[cat.key] || 0;
                              return (
                                <g
                                  key={cat.key}
                                  className={`team-page__chart-series team-page__chart-series--${cat.key}${
                                    catTotal === 0 ? ' team-page__chart-series--muted' : ''
                                  }`}
                                >
                                  <polyline
                                    className="team-page__chart-line"
                                    points={points}
                                    fill="none"
                                  />
                                  {months.map((m, i) => (
                                    <circle
                                      key={m.month}
                                      className="team-page__chart-dot"
                                      cx={xOf(i)}
                                      cy={yOf(m[cat.key] || 0)}
                                      r="4"
                                    >
                                      <title>{`${cat.label} · ${m.label}: ${m[cat.key] || 0}`}</title>
                                    </circle>
                                  ))}
                                </g>
                              );
                            })}
                          </svg>
                        </div>
                        <ul className="team-page__chart-legend" aria-hidden="true">
                          {CHART_CATEGORIES.map((cat) => {
                            const catTotal = selectedQuarterBucket?.[cat.key] || 0;
                            return (
                              <li
                                key={cat.key}
                                className={`team-page__chart-legend-item ${
                                  catTotal === 0 ? 'team-page__chart-legend-item--muted' : ''
                                }`}
                              >
                                <span
                                  className={`team-page__chart-legend-dot team-page__chart-legend-dot--${cat.key}`}
                                />
                                <span>{cat.label}</span>
                                <span className="team-page__chart-legend-count">
                                  {catTotal.toLocaleString('en-US')}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        {selectedQuarterBucket.otherTickets &&
                          selectedQuarterBucket.otherTickets.length > 0 && (
                            <details className="team-page__chart-other">
                              <summary className="team-page__chart-other-summary">
                                Show {selectedQuarterBucket.otherTickets.length}{' '}
                                {selectedQuarterBucket.otherTickets.length === 1
                                  ? "'Other' ticket"
                                  : "'Other' tickets"}
                              </summary>
                              <ul className="team-page__chart-other-list">
                                {selectedQuarterBucket.otherTickets.map((t) => {
                                  const completed = t.completedAt ? new Date(t.completedAt) : null;
                                  const completedLabel =
                                    completed && !Number.isNaN(completed.getTime())
                                      ? completed.toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                        })
                                      : null;
                                  return (
                                    <li key={t.id} className="team-page__chart-other-item">
                                      {t.identifier && (
                                        <span className="team-page__chart-other-id">
                                          {t.identifier}
                                        </span>
                                      )}
                                      {t.url ? (
                                        <a
                                          className="team-page__chart-other-title"
                                          href={t.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title={t.title}
                                        >
                                          {t.title}
                                        </a>
                                      ) : (
                                        <span
                                          className="team-page__chart-other-title"
                                          title={t.title}
                                        >
                                          {t.title}
                                        </span>
                                      )}
                                      {completedLabel && (
                                        <span className="team-page__chart-other-date">
                                          {completedLabel}
                                        </span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </details>
                          )}
                      </>
                    );
                  })()
                )
              ) : (
                <p className="team-page__linear-hint">
                  No data for Q{selectedQuarter} {linearClosed.year} yet.
                </p>
              )}
            </section>
          )}
        </>
      )}

      {/*
        Team view sections. "At a glance" team-wide rollup tiles followed by
        the per-AE breakdown. The page-level controls bar owns the filter
        pill, so these sections only carry their own title/subtitle.
      */}
      {view === VIEW_TEAM && (
        <>
          <section className="team-page__section">
            <div className="team-page__section-header">
              <div className="team-page__section-heading">
                <h2 className="team-page__section-title">At a glance</h2>
                <p className="team-page__section-subtitle">
                  {team.name} closed-won performance{' '}
                  {scope === SCOPE_QUARTER
                    ? `this quarter (${getCurrentQuarterShortLabel()})`
                    : 'this year'}
                  .
                </p>
              </div>
            </div>
            <div className="team-page__totals">
              <article className="metric-summary metric-summary--detailed">
                <div className="metric-summary__head">
                  <span className="metric-summary__label">Total CARR</span>
                  <span className="metric-summary__icon" aria-hidden="true">
                    <LuTrendingUp />
                  </span>
                </div>
                <div className="metric-summary__value">
                  {data ? formatCompactCurrency(teamTotals.totalCarr) : '—'}
                </div>
              </article>

              <article className="metric-summary metric-summary--detailed">
                <div className="metric-summary__head">
                  <span className="metric-summary__label">Closed Opps</span>
                  <span className="metric-summary__icon" aria-hidden="true">
                    <LuTrophy />
                  </span>
                </div>
                <div className="metric-summary__value">
                  {data ? teamTotals.count.toLocaleString('en-US') : '—'}
                </div>
              </article>

              <article className="metric-summary metric-summary--detailed">
                <div className="metric-summary__head">
                  <span className="metric-summary__label">Avg Deal Size</span>
                  <span className="metric-summary__icon" aria-hidden="true">
                    <LuChartBar />
                  </span>
                </div>
                <div className="metric-summary__value">
                  {data ? formatCompactCurrency(teamTotals.avgDealSize) : '—'}
                </div>
              </article>
            </div>
          </section>

          {/* CARR broken down by AE — same scope as the section above. */}
          <section className="team-page__section">
            <div className="team-page__section-header">
              <div className="team-page__section-heading">
                <h2 className="team-page__section-title">CARR broken down by AE</h2>
                <p className="team-page__section-subtitle">
                  Closed-won opportunities for {team.name}{' '}
                  {scope === SCOPE_QUARTER
                    ? `this quarter (${getCurrentQuarterShortLabel()})`
                    : 'this year'}
                  .
                </p>
              </div>
            </div>
            <div
              className="dashboard-widgets team-page__roster"
              style={{ '--ae-count': aes.length }}
            >
              {aes.map((ae) => {
                const opps = filteredOppsByAE.get(normalizeName(ae.name)) ?? [];
                const totalCarr = sumCarr(opps);
                return (
                  <section
                    key={ae.id}
                    className="dashboard-panel"
                    aria-labelledby={`team-ae-${ae.id}`}
                  >
                    <div className="dashboard-panel__head dashboard-panel__head--stacked">
                      <div className="dashboard-panel__head-text">
                        <h2 className="dashboard-panel__title" id={`team-ae-${ae.id}`}>
                          {ae.name}
                        </h2>
                        <p className="dashboard-panel__subtitle">
                          {opps.length === 0
                            ? 'No closed opps yet'
                            : `${opps.length} closed ${opps.length === 1 ? 'opp' : 'opps'}`}
                        </p>
                      </div>
                      {data && (
                        <div className="team-ae-total" aria-label={`Total CARR for ${ae.name}`}>
                          <span className="team-ae-total__label">Total CARR</span>
                          <span className="team-ae-total__value">{formatTotalCarr(totalCarr)}</span>
                        </div>
                      )}
                    </div>

                    {opps.length > 0 ? (
                      <ul className="team-ae-opp-list">
                        {opps.map((opp) => (
                          <li
                            key={opp.opportunityId || `${opp.opportunityName}-${opp.effectiveDate}`}
                            className="team-ae-opp-row"
                          >
                            <span className="team-ae-opp-name" title={opp.opportunityName}>
                              {opp.opportunityName || 'Untitled opportunity'}
                            </span>
                            <span className="team-ae-opp-carr">{formatCarr(opp)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : data ? (
                      <p className="team-ae-status">
                        {scope === SCOPE_QUARTER
                          ? `No closed opps for ${ae.name} this quarter yet.`
                          : `No closed opps for ${ae.name} yet this year.`}
                      </p>
                    ) : loading ? (
                      <p className="team-ae-status">Loading closed opps…</p>
                    ) : error ? (
                      <p className="team-ae-status">Couldn&apos;t load metrics for this AE.</p>
                    ) : (
                      <p className="team-ae-status">No closed opps yet.</p>
                    )}
                  </section>
                );
              })}
            </div>
          </section>

          {/*
            Closed-won C opps. Account-Score-C deals don't count toward the
            CARR goal (which is why they're absent from the tiles and per-AE
            cards above), but they're still real revenue — this panel surfaces
            every C opp on the team in a flat Opp / AE / CARR layout.

            Year-gated to 2026+. Earlier years' reports don't have an Account
            Score column at all, so the section would always be empty there.
          */}
          {currentYear >= 2026 && (
            <section className="team-page__section">
              <div className="team-page__section-header">
                <div className="team-page__section-heading">
                  <h2 className="team-page__section-title">Closed-won C opps</h2>
                  <p className="team-page__section-subtitle">
                    Account Score C deals don&apos;t count toward the CARR goal, but are tracked
                    here for visibility{' '}
                    {scope === SCOPE_QUARTER
                      ? `this quarter (${getCurrentQuarterShortLabel()})`
                      : 'this year'}
                    .
                  </p>
                </div>
              </div>
              <section className="dashboard-panel" aria-labelledby="team-c-opps-title">
                <div className="dashboard-panel__head">
                  <div className="dashboard-panel__head-text">
                    <h3 className="dashboard-panel__title" id="team-c-opps-title">
                      C-scored opportunities
                    </h3>
                    <p className="dashboard-panel__subtitle">
                      {data
                        ? cTeamTotals.count === 0
                          ? 'No C-scored deals in scope'
                          : `${cTeamTotals.count} ${
                              cTeamTotals.count === 1 ? 'opp' : 'opps'
                            } across the team`
                        : 'Loading…'}
                    </p>
                  </div>
                  {data && cTeamTotals.count > 0 && (
                    <div className="team-ae-total" aria-label="Total C-scored CARR for the team">
                      <span className="team-ae-total__label">Total CARR</span>
                      <span className="team-ae-total__value">
                        {formatTotalCarr(cTeamTotals.totalCarr)}
                      </span>
                    </div>
                  )}
                </div>

                {data && cOppsForTeam.length > 0 ? (
                  <ul className="team-c-opps-list">
                    <li className="team-c-opps-row team-c-opps-row--head" aria-hidden="true">
                      <span className="team-c-opps-row__opp">Opportunity</span>
                      <span className="team-c-opps-row__ae">AE</span>
                      <span className="team-c-opps-row__carr">CARR</span>
                    </li>
                    {cOppsForTeam.map(({ opp, aeName }) => (
                      <li
                        key={opp.opportunityId || `${opp.opportunityName}-${opp.effectiveDate}`}
                        className="team-c-opps-row"
                      >
                        <span className="team-c-opps-row__opp" title={opp.opportunityName}>
                          {opp.opportunityName || 'Untitled opportunity'}
                        </span>
                        <span className="team-c-opps-row__ae" title={aeName}>
                          {aeName}
                        </span>
                        <span className="team-c-opps-row__carr">{formatCarr(opp)}</span>
                      </li>
                    ))}
                  </ul>
                ) : data ? (
                  <p className="team-ae-status">
                    No C-scored closed-won opps for this team{' '}
                    {scope === SCOPE_QUARTER ? 'this quarter yet.' : 'yet this year.'}
                  </p>
                ) : loading ? (
                  <p className="team-ae-status">Loading C-scored opps…</p>
                ) : error ? (
                  <p className="team-ae-status">Couldn&apos;t load metrics for C opps.</p>
                ) : (
                  <p className="team-ae-status">No C-scored opps yet.</p>
                )}
              </section>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default OwnTeamView;
