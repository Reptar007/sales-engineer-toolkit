import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import {
  LuChartBar,
  LuClipboardCheck,
  LuFilePen,
  LuHammer,
  LuSparkles,
  LuTrendingUp,
  LuTrophy,
} from 'react-icons/lu';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchDashboardLinearClosed,
  fetchSalesforceReport,
  fetchSalesforceSnapshotMetrics,
  getSalesforceConfig,
} from '../../services/api';
import { toTeamSlug } from './slug';
import './team.less';

// Per-team hero artwork keyed by canonical slug. Files live in
// `frontend/public/` so they're served straight from the site root —
// no bundler import needed. Drop a new entry here (and the matching
// PNG into `public/`) to add a mascot for another team.
const TEAM_MASCOTS = {
  'team-yoshi': {
    src: '/yoshi_header.png',
    alt: 'Yoshi riding a dirt bike',
  },
};

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
    (config.snapshotYears || []).includes(yr) ||
    !!config.reportIdsByYear?.[yr]?.metrics;
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

/**
 * Walk every closed-won opp in the metrics payload and bucket them by
 * AE name (case-insensitive, whitespace-trimmed — same comparison the
 * backend uses in `userMetricsFilter.js` for SE-scoped views).
 *
 * Returns a Map keyed by the normalized AE name → array of opp rows
 * sorted by effective date desc (most recent close first).
 */
function groupOppsByAE(data) {
  const byAE = new Map();
  if (!data) return byAE;
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
    if (!byAE.has(key)) byAE.set(key, []);
    byAE.get(key).push(opp);
  }

  for (const list of byAE.values()) {
    list.sort((a, b) => {
      const da = a.effectiveDate ? Date.parse(a.effectiveDate) : 0;
      const db = b.effectiveDate ? Date.parse(b.effectiveDate) : 0;
      return db - da;
    });
  }

  return byAE;
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
// fractions like 9 or 13. Ensures we never show "7.25 tickets" on
// a gridline. Floors at 5 so a quarter with a single ticket still
// has room above the dot to breathe.
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
// fractional gridlines would look weird. For yMax=5 we end up with
// [0,1,2,3,4,5]; for yMax=10 we get [0,2,4,6,8,10]; for larger
// values we fall back to 5 evenly-spaced ticks.
function buildYTicks(yMax) {
  if (yMax <= 5) {
    return Array.from({ length: yMax + 1 }, (_, i) => i);
  }
  if (yMax <= 10) {
    return [0, 2, 4, 6, 8, 10].filter((v) => v <= yMax);
  }
  // 5 evenly-spaced ticks rounded to the nearest integer.
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
 * TeamPage - per-SE landing page ("Team Mario", "Team Yoshi", ...).
 *
 * Scope is intentionally "own team only" for now: each SE only ever sees
 * their own team's page. The :slug in the URL is cosmetic — if it doesn't
 * match the logged-in SE's team we redirect to the canonical slug instead
 * of 404'ing, so a stale bookmark or hand-typed URL still lands somewhere
 * useful.
 *
 * Visually the page borrows from The Den (the dashboard) without copying
 * the data: same `.page-header` heading treatment, same `.dashboard-panel`
 * panel surface and `.dashboard-widgets` grid layout. The body is one
 * panel per AE on the SE's team, with the AE's name as the panel title
 * and a row per closed-won opp underneath (Opportunity name + CARR).
 */
function TeamPage() {
  const { user } = useAuth();
  const { slug } = useParams();
  const team = user?.team;
  // First-name only for the personalized "Tickets closed by you" copy.
  // Pulled off the auth user, falls back to empty string so the
  // subtitle reads naturally ("Linear tickets you've completed…")
  // when we can't resolve a name.
  const firstName = useMemo(() => {
    const raw = (user?.name || '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0];
  }, [user?.name]);

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
  // "you" shows the personal Linear tickets section. We default to
  // "team" because the team page's mental model is "this is my team's
  // page" — the personal view is one click away when an SE wants to
  // zoom into their own contribution.
  const [view, setView] = useState(VIEW_TEAM);

  // Selected quarter for the You-view "Monthly breakdown" section.
  // Independent of the year/quarter filter pill — the filter pill
  // rescopes the topline tiles, while this picks which quarter the
  // chart below renders. Defaults to whichever quarter contains today.
  const [selectedQuarter, setSelectedQuarter] = useState(
    getCurrentQuarterNumber,
  );

  // Personal Linear roll-up (tickets THIS user has closed). Independent
  // of the Salesforce metrics fetch — different data source, different
  // failure modes — but driven by the same `scope` so toggling the
  // filter pill rescopes both halves of the page in lock-step. Tiles
  // render "—" while the request is in flight (no separate loading
  // flag needed) to mirror the SF tile loading behaviour below.
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
    return () => { cancelled = true; };
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
    // We always flip loading on while a refetch is in flight; the render
    // branches show the cached opp list whenever `data` is truthy
    // regardless of `loading`, so this doesn't cause a visible flicker
    // on warm caches. Avoids reading `data` inside the effect (which
    // would either need to be a dep or be silenced).
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

    return () => { cancelled = true; };
  }, [config, currentYear]);

  // Split "Team Mario" → { prefix: "Team", rest: "Mario" } so the prefix
  // can render in white and the actual identity (rest) can pop in coral,
  // matching the way the dashboard hero renders the team chip. Single-
  // word names just render the whole thing in coral.
  const teamParts = useMemo(() => {
    const raw = team?.name?.trim();
    if (!raw) return null;
    const idx = raw.indexOf(' ');
    if (idx === -1) return { prefix: '', rest: raw };
    return { prefix: raw.slice(0, idx), rest: raw.slice(idx + 1) };
  }, [team?.name]);

  const oppsByAE = useMemo(() => groupOppsByAE(data), [data]);

  // Apply the year / current-quarter scope. When viewing the year the
  // groupings pass through untouched; when viewing the current quarter
  // we filter each AE's list to opps whose `quarter` matches today's
  // quarter key (the same shape the metrics report writes, e.g.
  // "Q2 CY2026"), so the totals + rows + counts all stay in lock-step.
  const filteredOppsByAE = useMemo(() => {
    if (scope === SCOPE_YEAR) return oppsByAE;
    const currentKey = getCurrentQuarterKey();
    const next = new Map();
    for (const [aeKey, opps] of oppsByAE.entries()) {
      next.set(aeKey, opps.filter((opp) => opp.quarter === currentKey));
    }
    return next;
  }, [oppsByAE, scope]);

  // Roll up team-wide stats from the same filtered map that drives the
  // AE roster, so the at-a-glance tiles and the per-AE cards always
  // tell a consistent story (sum of AE totals === team total, etc.).
  const teamTotals = useMemo(() => {
    let totalCarr = 0;
    let count = 0;
    for (const opps of filteredOppsByAE.values()) {
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
  }, [filteredOppsByAE]);

  if (!team) {
    return (
      <div className="project-template">
        <div className="project-header">
          <h1>No team yet</h1>
          <p>You aren&apos;t assigned to a team. Ask an admin to attach you in the Alpha Pack.</p>
        </div>
      </div>
    );
  }

  const canonicalSlug = toTeamSlug(team.name);
  if (slug !== canonicalSlug) {
    return <Navigate to={`/teams/${canonicalSlug}`} replace />;
  }

  const aes = team.accountExecutives ?? [];
  const mascot = TEAM_MASCOTS[canonicalSlug];

  return (
    <div className="dashboard">
      {/*
        Three-column hero: flexible spacer on the left, big centered
        title in the middle, optional mascot pinned to the right. The
        two 1fr edge columns balance so the title stays visually
        centered regardless of whether the team has mascot artwork.
      */}
      <header className="page-header team-page__hero">
        <h1 className="team-page__hero-title">
          {teamParts.prefix && <>{teamParts.prefix} </>}
          <span className="page-header__name">{teamParts.rest}</span>
        </h1>
        {mascot && (
          <img
            className="team-page__mascot"
            src={mascot.src}
            alt={mascot.alt}
          />
        )}
      </header>

      {aes.length === 0 ? (
        <p className="page-header__sub">
          No active AEs on this team yet. Ask an admin to add one in the Alpha Pack.
        </p>
      ) : (
        // Body wrapper insets the content horizontally from the
        // full-bleed hero above so the section reads as a nested
        // zone. New sections (Pipeline, Activity, etc.) live as
        // additional siblings inside this wrapper and inherit the
        // same gutter for free.
        <div className="team-page__body">
          {/*
            Page-level controls bar. Two segmented toggles share a row
            so all the page-wide knobs live in one predictable spot at
            the top of the body:
              • "View" picks the section set below (Team vs You).
              • "Scope" rescopes whichever sections are showing
                (year vs current quarter).
            Both controls follow whichever view is active — a quarter
            scope on Team mode rescopes the SF roll-up; same scope on
            You mode rescopes the Linear roll-up.
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
            "Tickets closed by you" — personal Linear roll-up. Only
            renders in the You view; on Team view the page focuses
            on the SF roll-up + AE breakdown below. The fragment
            wraps two sibling sections (tickets tiles + monthly
            breakdown chart) under the same view gate.
          */}
          {view === VIEW_YOU && (
          <>
          <section className="team-page__section">
            <div className="team-page__section-header">
              <div className="team-page__section-heading">
                <h2 className="team-page__section-title">
                  Tickets closed by you
                </h2>
                <p className="team-page__section-subtitle">
                  {(() => {
                    const subject = firstName
                      ? `${firstName} has`
                      : "you've";
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
              // SE row exists but we couldn't auto-resolve their Linear
              // user ID from email. Surface the same hint the dashboard
              // would, but inline so the section still has presence.
              <p className="team-page__linear-hint">
                We couldn&apos;t match your account to a Linear user yet.
                Check your Profile so we can pull in your closed tickets.
              </p>
            ) : linearError || linearClosed?.error === 'linear_unavailable' ? (
              // Either the request itself blew up (linearError) or the
              // backend returned a soft 200 indicating Linear was
              // unreachable. Same UX in both cases — a calm
              // "try again later" beats spinning placeholders forever.
              <p className="team-page__linear-hint">
                Couldn&apos;t load your closed tickets right now. Try
                refreshing in a minute.
              </p>
            ) : (
              <div
                className="team-page__totals"
                // The You view shows 4 tiles (adds AI Demo). Override
                // the default 3-column layout via the parameterized
                // `--tile-cols` custom property so we don't need a
                // dedicated modifier class for this single use.
                style={{ '--tile-cols': 4 }}
              >
                {/*
                  Four tiles: Tickets Closed (total) + Estimation +
                  Creation + AI Demo. Reuses `.metric-summary--detailed`
                  so the layout is identical to At a glance on the
                  Team view. Each tile carries a small "avg Xd to
                  close" caption (pulled from createdAt →
                  completedAt). The caption is suppressed when a
                  category has zero closed tickets so we don't render
                  a misleading "0d".
                */}
                <article className="metric-summary metric-summary--detailed">
                  <div className="metric-summary__head">
                    <span className="metric-summary__label">Tickets Closed</span>
                    <span className="metric-summary__icon" aria-hidden="true">
                      <LuClipboardCheck />
                    </span>
                  </div>
                  <div className="metric-summary__value">
                    {closedTicketsScoped
                      ? closedTicketsScoped.total.toLocaleString('en-US')
                      : '—'}
                  </div>
                  {closedTicketsScoped &&
                    formatAvgLeadTime(closedTicketsScoped.avgDaysTotal) && (
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
                          {formatAvgLeadTime(
                            closedTicketsScoped.avgDaysEstimation,
                          )}
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
                          {formatAvgLeadTime(
                            closedTicketsScoped.avgDaysCreation,
                          )}
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
                      ? (closedTicketsScoped.aiDemo ?? 0).toLocaleString(
                          'en-US',
                        )
                      : '—'}
                  </div>
                  {closedTicketsScoped &&
                    formatAvgLeadTime(closedTicketsScoped.avgDaysAiDemo) && (
                      <div className="metric-summary__foot">
                        <span className="metric-summary__hint">
                          {formatAvgLeadTime(
                            closedTicketsScoped.avgDaysAiDemo,
                          )}
                        </span>
                      </div>
                    )}
                </article>
              </div>
            )}
          </section>

          {/*
            Monthly breakdown — second section in the You view. A
            quarter-tab strip across the top picks which quarter the
            chart renders. Bars are monthly counts; the caption under
            each bar is that month's share of the quarter (the user's
            requested "closed percentage per ticket").
          */}
          {linearClosed?.configured && (
            <section className="team-page__section">
              <div className="team-page__section-header">
                <div className="team-page__section-heading">
                  <h2 className="team-page__section-title">
                    Monthly breakdown
                  </h2>
                  <p className="team-page__section-subtitle">
                    Tickets you closed each month of Q{selectedQuarter}{' '}
                    {linearClosed.year}.
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
                      className={`team-page__filter-btn ${
                        selectedQuarter === q ? 'is-active' : ''
                      }`}
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
                    No tickets closed in Q{selectedQuarter}{' '}
                    {linearClosed.year} yet.
                  </p>
                ) : (
                  // Build the line chart. We compute the y-axis
                  // ceiling from the largest single-category count
                  // (not the month total) because the chart plots
                  // per-category lines — using the month total would
                  // leave huge headroom above every line. Floor at
                  // 1 to dodge a divide-by-zero on empty quarters.
                  (() => {
                    const months = selectedQuarterBucket.byMonth || [];
                    const dataMax = Math.max(
                      1,
                      ...months.flatMap((m) =>
                        CHART_CATEGORIES.map((c) => m[c.key] || 0),
                      ),
                    );
                    const yMax = niceChartMax(dataMax);
                    const yTicks = buildYTicks(yMax);

                    const plotW =
                      CHART_VIEWBOX_W - CHART_PAD.left - CHART_PAD.right;
                    const plotH =
                      CHART_VIEWBOX_H - CHART_PAD.top - CHART_PAD.bottom;
                    // X anchors data points to the plot edges (first
                    // month at left, last at right) — standard line-
                    // chart layout for sparse series like 3 months.
                    const xOf = (i) =>
                      months.length === 1
                        ? CHART_PAD.left + plotW / 2
                        : CHART_PAD.left +
                          (i / (months.length - 1)) * plotW;
                    const yOf = (v) =>
                      CHART_PAD.top + plotH - (v / yMax) * plotH;

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
                            {/* Y-axis gridlines + count labels.
                                Drawn first so they sit behind the
                                lines instead of slicing across them. */}
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

                            {/* X-axis month labels, centered below
                                each data point. */}
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

                            {/* One polyline per category, with a dot
                                at each month's data point. The dot
                                carries a <title> so hovering the
                                point shows "Creation - May: 4". */}
                            {CHART_CATEGORIES.map((cat) => {
                              const points = months
                                .map(
                                  (m, i) =>
                                    `${xOf(i)},${yOf(m[cat.key] || 0)}`,
                                )
                                .join(' ');
                              const catTotal =
                                selectedQuarterBucket?.[cat.key] || 0;
                              return (
                                <g
                                  key={cat.key}
                                  className={`team-page__chart-series team-page__chart-series--${cat.key}${
                                    catTotal === 0
                                      ? ' team-page__chart-series--muted'
                                      : ''
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
                        {/*
                          Legend lives just below the chart so the
                          color → category mapping is always visible
                          without making the bars themselves carry
                          inline labels. Categories with zero across
                          the whole quarter are dimmed so the legend
                          quietly self-prunes for sparse quarters.
                        */}
                        <ul className="team-page__chart-legend" aria-hidden="true">
                          {CHART_CATEGORIES.map((cat) => {
                            const catTotal =
                              (selectedQuarterBucket?.[cat.key] || 0);
                            return (
                              <li
                                key={cat.key}
                                className={`team-page__chart-legend-item ${
                                  catTotal === 0
                                    ? 'team-page__chart-legend-item--muted'
                                    : ''
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
                        {/*
                          "Other" tickets disclosure. The Other bucket
                          is a catch-all for closed tickets that don't
                          match the Estimation / Creation / AI Demo
                          patterns; this collapsible list exists so
                          the SE can scan the actual titles, decide if
                          a ticket should have been classified, and
                          open it in Linear to fix the title or label.
                          Native <details> handles the open/close
                          state without any React plumbing.
                        */}
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
                                {selectedQuarterBucket.otherTickets.map(
                                  (t) => {
                                    const completed = t.completedAt
                                      ? new Date(t.completedAt)
                                      : null;
                                    const completedLabel =
                                      completed &&
                                      !Number.isNaN(completed.getTime())
                                        ? completed.toLocaleDateString(
                                            'en-US',
                                            {
                                              month: 'short',
                                              day: 'numeric',
                                            },
                                          )
                                        : null;
                                    return (
                                      <li
                                        key={t.id}
                                        className="team-page__chart-other-item"
                                      >
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
                                  },
                                )}
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
            Team view sections. "At a glance" team-wide rollup tiles
            followed by per-AE breakdown. The page-level controls bar
            owns the filter pill, so these sections only carry their
            own title/subtitle.
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
              {/*
                Three tiles share the dashboard's `.metric-summary--detailed`
                styling so the team page's at-a-glance row reads as
                the same design language as The Den's metric tiles.
                Values render "—" while the metrics fetch is in
                flight so the layout doesn't shift on load.
              */}
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
          /*
            Drive the grid's column count from the AE count so every AE
            panel ends up on the same row. CSS falls back to the wrapped
            2-column / 1-column layouts below 1024px so the cards don't
            get squeezed unreadably narrow on smaller screens.
          */
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
                  {/*
                    Total CARR readout. Only rendered once the metrics
                    payload has loaded so we don't flash a "$0" total
                    while the fetch is still in flight. Anchors the
                    coral column of per-row CARR amounts below.
                  */}
                  {data && (
                    <div className="team-ae-total" aria-label={`Total CARR for ${ae.name}`}>
                      <span className="team-ae-total__label">Total CARR</span>
                      <span className="team-ae-total__value">
                        {formatTotalCarr(totalCarr)}
                      </span>
                    </div>
                  )}
                </div>

                {/*
                  Three render branches, in priority order:
                    1. We have opps → show the row list.
                    2. We have data but this AE has none → quiet hint.
                    3. We're still waiting on data / hit an error → status row.
                  Splitting them out (instead of always showing the list)
                  keeps the panel from flashing an empty state on first
                  paint while the metrics fetch is in flight.
                */}
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
          </>
          )}
        </div>
      )}
    </div>
  );
}

export default TeamPage;
