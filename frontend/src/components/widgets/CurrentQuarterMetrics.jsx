import React, { useState, useEffect } from 'react';
import { LuTarget, LuTrendingUp, LuTrophy, LuChartBar } from 'react-icons/lu';
import {
  fetchSalesforceReport,
  getSalesforceConfig,
  fetchSalesforceSnapshotMetrics,
} from '../../services/api';
import '../../styles/CurrentQuarterMetrics.less';

const CONFIG_CACHE_KEY = 'currentQuarterMetrics.config';
const DATA_CACHE_KEY = 'currentQuarterMetrics.dataByYear';

/**
 * Get current quarter based on actual date
 * Format: Q1 CY2025, Q2 CY2025, etc.
 */
function getCurrentQuarter() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  let quarter;
  if (month >= 1 && month <= 3) {
    quarter = 1;
  } else if (month >= 4 && month <= 6) {
    quarter = 2;
  } else if (month >= 7 && month <= 9) {
    quarter = 3;
  } else {
    quarter = 4;
  }

  return `Q${quarter} CY${year}`;
}

/**
 * Current Quarter Metrics Widget - Summary version for home page
 */
function CurrentQuarterMetrics() {
  const [config, setConfig] = useState(() => {
    try {
      const cached = localStorage.getItem(CONFIG_CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const actualCurrentQuarter = getCurrentQuarter();
  const calendarYear = new Date().getFullYear();

  // Resolve the best year to display: current year if it has data, otherwise
  // the most recent configured year that has a report ID or snapshot.
  const resolveDataYear = (c) => {
    if (!c) return calendarYear;
    const hasData = (yr) =>
      (c.snapshotYears || []).includes(yr) || !!c.reportIdsByYear?.[yr]?.metrics;
    if (hasData(calendarYear)) return calendarYear;
    const allYears = [
      ...new Set([...Object.keys(c.reportIdsByYear || {}).map(Number), ...(c.snapshotYears || [])]),
    ].sort((a, b) => b - a);
    return allYears.find(hasData) ?? calendarYear;
  };

  const currentYear = resolveDataYear(config);

  useEffect(() => {
    let cancelled = false;
    if (config) {
      setLoading(false);
    }
    getSalesforceConfig()
      .then((c) => {
        if (!cancelled) {
          setConfig(c);
          localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(c));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load config');
          if (!data) setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    const isSnapshotYear = (config.snapshotYears || []).includes(currentYear);
    const reportId = config.reportIdsByYear?.[currentYear]?.metrics;
    if (!isSnapshotYear && !reportId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!data) setLoading(true);
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
        if (!cancelled) {
          setData(response);
          setError(null);
          try {
            const raw = localStorage.getItem(DATA_CACHE_KEY);
            const byYear = raw ? JSON.parse(raw) : {};
            byYear[currentYear] = response;
            localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(byYear));
          } catch {
            // ignore cache write issues
          }
        }
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

  const quarterlyData = data?.quarterlyData || {};

  // Quarter order for sorting: Q1 < Q2 < Q3 < Q4
  const quarterOrder = (key) => {
    const match = key.match(/^Q(\d) CY(\d+)$/);
    if (!match) return -1;
    return parseInt(match[2]) * 4 + parseInt(match[1]);
  };

  // Find the most recent quarter at or before the current one that has data
  const currentQuarterKey = (() => {
    if (quarterlyData[actualCurrentQuarter]) return actualCurrentQuarter;
    const currentOrder = quarterOrder(actualCurrentQuarter);
    const pastQuarters = Object.keys(quarterlyData)
      .filter((key) => key !== 'Total' && quarterOrder(key) <= currentOrder)
      .sort((a, b) => quarterOrder(b) - quarterOrder(a));
    return pastQuarters[0] || actualCurrentQuarter;
  })();
  const currentQuarterData = quarterlyData[currentQuarterKey] || {};
  const currentQuarterCARR = currentQuarterData?.totalCARR || 0;

  const quarterlyGoals = config?.goalsByYear?.[currentYear] || [];
  const currentQuarterGoal = quarterlyGoals.find((q) => q.label === currentQuarterKey)?.goal || 0;

  const calculateGoalProgress = (current, goal) => {
    if (!current || !goal) return 0;
    return (current / goal) * 100;
  };

  const formatNumber = (num) => {
    if (!num) return '0';
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
  };

  const quarterlyProgress = calculateGoalProgress(currentQuarterCARR, currentQuarterGoal);

  // Pull just the quarter number out of keys like "Q2 CY2026" so labels can
  // read as "Quarter 2 Goal" / "Quarter 2 CARR" instead of the generic
  // "Quarter Goal" / "Quarter CARR".
  const currentQuarterNumber = currentQuarterKey.match(/^Q(\d)/)?.[1];
  const quarterGoalLabel = currentQuarterNumber
    ? `Quarter ${currentQuarterNumber} Goal`
    : 'Quarter Goal';
  const quarterCarrLabel = currentQuarterNumber
    ? `Quarter ${currentQuarterNumber} CARR`
    : 'Quarter CARR';

  // Resolve the *previous* quarter key so we can compute delta vs last
  // quarter on the first two cards. "Q2 CY2026" → "Q1 CY2026", and
  // "Q1 CY2026" wraps back to "Q4 CY2025".
  const previousQuarterKey = (() => {
    const match = currentQuarterKey.match(/^Q(\d)\s+CY(\d+)$/);
    if (!match) return null;
    const q = parseInt(match[1], 10);
    const yr = parseInt(match[2], 10);
    return q === 1 ? `Q4 CY${yr - 1}` : `Q${q - 1} CY${yr}`;
  })();

  const previousQuarterData = previousQuarterKey ? quarterlyData[previousQuarterKey] || {} : {};
  const previousQuarterCARR = previousQuarterData?.totalCARR || 0;
  const previousQuarterGoal = previousQuarterKey
    ? quarterlyGoals.find((q) => q.label === previousQuarterKey)?.goal || 0
    : 0;

  // ---- Lead / no-AE view stats (Pack-wide totals) ------------------------
  // The Salesforce response already includes opportunityCount per quarter,
  // so we can compute these client-side without a new endpoint.
  const currentPackWins = currentQuarterData?.opportunityCount || 0;
  const previousPackWins = previousQuarterData?.opportunityCount || 0;

  // Average deal size = total CARR / number of closed-won opps for the
  // quarter. Guarded against div-by-zero on quarters with no wins.
  const safeAvg = (total, count) => (count > 0 ? total / count : 0);
  const currentAvgDealSize = safeAvg(currentQuarterCARR, currentPackWins);
  const previousAvgDealSize = safeAvg(previousQuarterCARR, previousPackWins);

  // ---- SE-scoped stats (right-two tiles when user has AEs) ---------------
  // Backend attaches `quarterlyDataForUser` (same shape as `quarterlyData`)
  // and a `userAECount` when the requester is an SE with at least one
  // assigned AE. Admins / SEs without a team get neither, in which case
  // we transparently fall back to the pack-wide Wins + Avg Deal Size
  // tiles below.
  const userQuarterlyData = data?.quarterlyDataForUser;
  const userAECount = data?.userAECount || 0;
  const showUserTiles = !!userQuarterlyData && userAECount > 0;

  const currentUserData = userQuarterlyData?.[currentQuarterKey] || {};
  const previousUserData = previousQuarterKey ? userQuarterlyData?.[previousQuarterKey] || {} : {};
  const currentUserWins = currentUserData?.opportunityCount || 0;
  const previousUserWins = previousUserData?.opportunityCount || 0;
  const currentUserCARR = currentUserData?.totalCARR || 0;
  const previousUserCARR = previousUserData?.totalCARR || 0;
  // ------------------------------------------------------------------------

  const goalDelta = currentQuarterGoal - previousQuarterGoal;
  const carrDelta = currentQuarterCARR - previousQuarterCARR;
  const winsDelta = currentPackWins - previousPackWins;
  const avgDealDelta = currentAvgDealSize - previousAvgDealSize;
  const userWinsDelta = currentUserWins - previousUserWins;
  const userCARRDelta = currentUserCARR - previousUserCARR;

  // Format a signed delta into "+$120K" / "−45" / etc. with a tone hint so
  // the styles can tint green for growth and coral for a drop. The
  // `formatValue` callback lets the caller pick the unit (currency, plain
  // count, percentage, …). Returns null when there's no prior data to
  // compare against so the card can hide the delta gracefully.
  const formatDelta = (delta, hasBaseline, formatValue = (n) => `$${formatNumber(n)}`) => {
    if (!hasBaseline) return null;
    if (!delta) return { text: formatValue(0), tone: 'flat' };
    const sign = delta > 0 ? '+' : '−';
    const tone = delta > 0 ? 'up' : 'down';
    return { text: `${sign}${formatValue(Math.abs(delta))}`, tone };
  };

  const goalDeltaInfo = formatDelta(goalDelta, !!previousQuarterGoal);
  const carrDeltaInfo = formatDelta(carrDelta, !!previousQuarterCARR);
  // Pack Wins delta is a plain integer count (no `$`), formatted as e.g. "+3".
  const winsDeltaInfo = formatDelta(winsDelta, !!previousPackWins, (n) => `${Math.round(n)}`);
  // Avg deal size is currency.
  const avgDealDeltaInfo = formatDelta(avgDealDelta, !!previousAvgDealSize);
  // SE-scoped equivalents of the above two. Wins delta is a plain count,
  // CARR delta is currency, both keyed off the *user's* prior quarter.
  const userWinsDeltaInfo = formatDelta(
    userWinsDelta,
    !!previousUserWins,
    (n) => `${Math.round(n)}`,
  );
  const userCARRDeltaInfo = formatDelta(userCARRDelta, !!previousUserCARR);

  const previousQuarterShortLabel = previousQuarterKey
    ? previousQuarterKey.replace(/\s+CY/, ' ')
    : '';

  if (loading) {
    return (
      <div className="current-quarter-metrics">
        <p className="current-quarter-metrics__status">Loading metrics...</p>
      </div>
    );
  }

  if (error) {
    if (error.includes('credentials not configured') || error.includes('no username password')) {
      return null;
    }
    return (
      <div className="current-quarter-metrics">
        <p className="current-quarter-metrics__status current-quarter-metrics__status--error">
          Unable to load metrics. Please check your Salesforce configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="current-quarter-metrics">
      <div className="metrics-grid">
        {/*
          NOTE: We deliberately use <div> (not <header>/<footer>) for the
          card sub-sections. App.less defines a global `footer { ... }`
          rule with `margin-left: 18rem` + a dark background, which would
          otherwise leak in and render as a dark tab hanging off the side
          of every metric card.
        */}
        <div className="metric-summary metric-summary--detailed">
          <div className="metric-summary__head">
            <span className="metric-summary__label">{quarterGoalLabel}</span>
            <span className="metric-summary__icon" aria-hidden="true">
              <LuTarget />
            </span>
          </div>
          <div className="metric-summary__value">${formatNumber(currentQuarterGoal)}</div>
          <div className="metric-summary__foot">
            {goalDeltaInfo ? (
              <span
                className={`metric-summary__delta metric-summary__delta--${goalDeltaInfo.tone}`}
              >
                {goalDeltaInfo.text}
              </span>
            ) : (
              <span className="metric-summary__delta metric-summary__delta--muted">—</span>
            )}
            <span className="metric-summary__hint">
              {previousQuarterShortLabel ? `vs ${previousQuarterShortLabel}` : 'vs last quarter'}
            </span>
          </div>
        </div>

        <div className="metric-summary metric-summary--detailed">
          <div className="metric-summary__head">
            <span className="metric-summary__label">{quarterCarrLabel}</span>
            <span className="metric-summary__icon" aria-hidden="true">
              <LuTrendingUp />
            </span>
          </div>
          <div className="metric-summary__value">${formatNumber(currentQuarterCARR)}</div>
          <div className="metric-summary__foot">
            {carrDeltaInfo ? (
              <span
                className={`metric-summary__delta metric-summary__delta--${carrDeltaInfo.tone}`}
              >
                {carrDeltaInfo.text}
              </span>
            ) : (
              <span className="metric-summary__delta metric-summary__delta--muted">—</span>
            )}
            <span className="metric-summary__hint">{quarterlyProgress.toFixed(1)}% of goal</span>
          </div>
        </div>

        {/*
          Right-two tiles: SE-scoped "My Wins" + "My CARR" when the user
          has assigned AEs (backend attaches `quarterlyDataForUser`),
          otherwise pack-wide "Pack Wins" + "Avg Deal Size" so admins and
          team-less SEs still see useful momentum numbers.
        */}
        {showUserTiles ? (
          <>
            <div className="metric-summary metric-summary--detailed">
              <div className="metric-summary__head">
                <span className="metric-summary__label">
                  {currentQuarterNumber ? `My Wins Q${currentQuarterNumber}` : 'My Wins'}
                </span>
                <span className="metric-summary__icon" aria-hidden="true">
                  <LuTrophy />
                </span>
              </div>
              <div className="metric-summary__value">{currentUserWins}</div>
              <div className="metric-summary__foot">
                {userWinsDeltaInfo ? (
                  <span
                    className={`metric-summary__delta metric-summary__delta--${userWinsDeltaInfo.tone}`}
                  >
                    {userWinsDeltaInfo.text}
                  </span>
                ) : (
                  <span className="metric-summary__delta metric-summary__delta--muted">—</span>
                )}
                {/*
                  Mirror the Pack Wins subtitle pattern so the delta has a
                  named baseline. Falls back to the AE-count context only
                  when there's no prior quarter to compare against.
                */}
                <span
                  className="metric-summary__hint"
                  title={`Filtered by your ${userAECount} assigned AE${userAECount === 1 ? '' : 's'}`}
                >
                  {previousUserWins
                    ? `${previousUserWins} last quarter`
                    : `from ${userAECount} AE${userAECount === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>

            <div className="metric-summary metric-summary--detailed">
              <div className="metric-summary__head">
                <span className="metric-summary__label">
                  {currentQuarterNumber ? `My CARR Q${currentQuarterNumber}` : 'My CARR'}
                </span>
                <span className="metric-summary__icon" aria-hidden="true">
                  <LuChartBar />
                </span>
              </div>
              <div className="metric-summary__value">${formatNumber(currentUserCARR)}</div>
              <div className="metric-summary__foot">
                {userCARRDeltaInfo ? (
                  <span
                    className={`metric-summary__delta metric-summary__delta--${userCARRDeltaInfo.tone}`}
                  >
                    {userCARRDeltaInfo.text}
                  </span>
                ) : (
                  <span className="metric-summary__delta metric-summary__delta--muted">—</span>
                )}
                {/*
                  Mirror the Avg Deal Size subtitle pattern: lead with the
                  named baseline ("vs $X last quarter") so the delta makes
                  sense at a glance. Fall back to the AE-count context only
                  when there's no prior quarter to compare against. The
                  `title` keeps the AE-count tooltip available either way.
                */}
                <span
                  className="metric-summary__hint"
                  title={`Filtered by your ${userAECount} assigned AE${userAECount === 1 ? '' : 's'}`}
                >
                  {previousUserCARR
                    ? `vs $${formatNumber(previousUserCARR)} last quarter`
                    : `from ${userAECount} AE${userAECount === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="metric-summary metric-summary--detailed">
              <div className="metric-summary__head">
                <span className="metric-summary__label">
                  {currentQuarterNumber ? `Pack Wins Q${currentQuarterNumber}` : 'Pack Wins'}
                </span>
                <span className="metric-summary__icon" aria-hidden="true">
                  <LuTrophy />
                </span>
              </div>
              <div className="metric-summary__value">{currentPackWins}</div>
              <div className="metric-summary__foot">
                {winsDeltaInfo ? (
                  <span
                    className={`metric-summary__delta metric-summary__delta--${winsDeltaInfo.tone}`}
                  >
                    {winsDeltaInfo.text}
                  </span>
                ) : (
                  <span className="metric-summary__delta metric-summary__delta--muted">—</span>
                )}
                <span className="metric-summary__hint">
                  {previousPackWins ? `${previousPackWins} last quarter` : 'no prior data'}
                </span>
              </div>
            </div>

            <div className="metric-summary metric-summary--detailed">
              <div className="metric-summary__head">
                <span className="metric-summary__label">
                  {currentQuarterNumber
                    ? `Avg Deal Size Q${currentQuarterNumber}`
                    : 'Avg Deal Size'}
                </span>
                <span className="metric-summary__icon" aria-hidden="true">
                  <LuChartBar />
                </span>
              </div>
              <div className="metric-summary__value">${formatNumber(currentAvgDealSize)}</div>
              <div className="metric-summary__foot">
                {avgDealDeltaInfo ? (
                  <span
                    className={`metric-summary__delta metric-summary__delta--${avgDealDeltaInfo.tone}`}
                  >
                    {avgDealDeltaInfo.text}
                  </span>
                ) : (
                  <span className="metric-summary__delta metric-summary__delta--muted">—</span>
                )}
                <span className="metric-summary__hint">
                  {previousAvgDealSize
                    ? `vs $${formatNumber(previousAvgDealSize)} last quarter`
                    : 'no prior data'}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CurrentQuarterMetrics;
