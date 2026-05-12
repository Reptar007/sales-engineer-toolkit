import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import './HuntClock.less';

/**
 * HuntClock
 *
 * A playful "how much of the quarter is left" tracker that lives between
 * the dashboard hero and the metric tiles. It surfaces three bits of
 * information at a glance:
 *
 *   - Days remaining in the current calendar quarter
 *   - % of the quarter that has elapsed
 *   - A character (placeholder paw for now) running along a progress
 *     bar from the kickoff month to the close month
 *
 * The component is purely date-driven — no props are required — but
 * accepts an optional `now` for tests / Storybook overrides.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTH_ABBREV = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Progress tiers that drive the card's "urgency" treatment — border
// hue, fill saturation, and the coral wash all shift together so the
// hero card visibly tightens as the quarter winds down. Boundaries
// (loosely "weeks left in a 13-week quarter") chosen so that:
//   - "fresh"  (0–25%, ~first 3 weeks): calmer, cool-tinted border
//   - "mid"    (25–65%, brand default): the coral look most of the
//                                       quarter sees
//   - "late"   (65–85%, ~last 5 weeks): warm orange, eye-catching
//   - "crunch" (85–100%, ~last 2 weeks): hot red + pulsing glow
function tierForProgress(pct) {
  if (pct >= 85) return 'crunch';
  if (pct >= 65) return 'late';
  if (pct >= 25) return 'mid';
  return 'fresh';
}

const VALID_TIERS = ['fresh', 'mid', 'late', 'crunch'];

// Dev-only escape hatch for previewing a specific tier without
// time-traveling. Mirrors the `?mock_hunts=1` pattern used by
// DashboardWidgets — accepts either a URL param (good for one-off
// screenshots / sharing a preview link) or a localStorage value
// (sticks across reloads while iterating).
//
//   ?hunt_clock_tier=fresh|mid|late|crunch
//   localStorage.huntClockTier = 'fresh'
//
// Returns null in production builds and when no override is set, so
// the live tier always wins for real users.
function readTierOverride() {
  if (!import.meta.env.DEV) return null;
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('hunt_clock_tier');
    if (fromUrl && VALID_TIERS.includes(fromUrl)) return fromUrl;
    const fromStorage = window.localStorage?.getItem('huntClockTier');
    if (fromStorage && VALID_TIERS.includes(fromStorage)) return fromStorage;
  } catch {
    // localStorage / URLSearchParams can throw in locked-down sandboxes;
    // fall through to "no override" rather than crashing the dashboard.
  }
  return null;
}

// Strip the time portion of a date so range math (days remaining, %
// elapsed) lines up with calendar-day expectations rather than wall-clock
// instants. Without this, "X days till end of Q2" can flicker by one as
// the clock crosses midnight in different timezones.
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Return { qNumber, start, end, year } for the calendar quarter the
// given date falls into. `end` is the last day of the last month, NOT
// the first day of the next quarter, so "Q2 close" reads as Jun 30
// rather than Jul 1.
function getQuarterRange(date) {
  const month = date.getMonth();
  const year = date.getFullYear();
  const qIndex = Math.floor(month / 3);
  const startMonth = qIndex * 3;
  const start = new Date(year, startMonth, 1);
  // Day 0 of "next month" === last day of current month.
  const end = new Date(year, startMonth + 3, 0);
  return { qNumber: qIndex + 1, start, end, year };
}

function HuntClock({ now }) {
  const { qNumber, qLabel, daysLeft, percentElapsed, months, kickoffLabel, closeLabel } =
    useMemo(() => {
      const today = startOfDay(now ?? new Date());
      const range = getQuarterRange(today);
      const startMs = range.start.getTime();
      const endMs = range.end.getTime();
      const todayMs = today.getTime();

      // "Days till end of quarter" uses inclusive-bookend day counting
      // so May 8 → Jun 30 reads as 54 days (24 in May + 30 in June)
      // rather than 53 (which would skip today). Math.round on ms diffs
      // immunizes against DST transitions inside the quarter — without
      // it, the 23h spring-forward day would drop a count.
      const totalDaysInclusive = Math.round((endMs - startMs) / MS_PER_DAY) + 1;
      const daysRemaining = Math.max(
        0,
        Math.min(totalDaysInclusive, Math.round((endMs - todayMs) / MS_PER_DAY) + 1),
      );

      // Bar-position math is boundary-to-boundary (Apr 1 = 0%, Jun 30 =
      // 100%). The character, the displayed "% through" text, and the
      // month-start ticks all share the same denominator so they can
      // never drift apart on screen — at May 8, character at 41.1%
      // sits exactly past the May 1 boundary tick at 33.3%.
      const totalSpanMs = endMs - startMs;
      const elapsedMs = Math.max(0, Math.min(totalSpanMs, todayMs - startMs));
      const pct = totalSpanMs > 0 ? (elapsedMs / totalSpanMs) * 100 : 0;

      const startMonthIdx = range.start.getMonth();
      const months = [0, 1, 2].map((offset) => {
        const monthStart = new Date(range.year, startMonthIdx + offset, 1);
        const monthPct =
          totalSpanMs > 0 ? ((monthStart.getTime() - startMs) / totalSpanMs) * 100 : 0;
        return {
          label: MONTH_ABBREV[startMonthIdx + offset],
          pct: Math.max(0, Math.min(100, monthPct)),
        };
      });

      const fmtDay = (d) => `${MONTH_ABBREV[d.getMonth()]} ${d.getDate()}`;

      return {
        qNumber: range.qNumber,
        qLabel: `Q${range.qNumber}`,
        daysLeft: daysRemaining,
        percentElapsed: pct,
        months,
        kickoffLabel: fmtDay(range.start),
        closeLabel: fmtDay(range.end),
      };
    }, [now]);

  // Cap the character position at 99% so the character never clips off
  // the right edge of the bar at quarter end. Floor at 1% so Axo
  // doesn't tuck behind the start cap on day one of the quarter.
  const characterLeft = Math.max(1, Math.min(99, percentElapsed));
  const fillWidth = Math.max(0, Math.min(100, percentElapsed));
  const pctRounded = Math.round(percentElapsed * 10) / 10;
  // Dev preview override wins over the date-driven tier so designers
  // can screenshot any treatment without faking the system clock.
  // `useMemo([])` is fine here — the override is read once at mount;
  // changing the URL param requires a reload to take effect, which
  // matches how the sibling `?mock_hunts=1` toggle behaves.
  const tierOverride = useMemo(readTierOverride, []);
  const tier = tierOverride ?? tierForProgress(percentElapsed);

  return (
    <section className={`hunt-clock hunt-clock--tier-${tier}`} aria-labelledby="hunt-clock-title">
      <div className="hunt-clock__head">
        <div className="hunt-clock__head-left">
          <p className="hunt-clock__overline">The Hunt Clock</p>
          <h2 className="hunt-clock__title" id="hunt-clock-title">
            <span className="hunt-clock__count">{daysLeft}</span> {daysLeft === 1 ? 'day' : 'days'}{' '}
            till end of <span className="hunt-clock__quarter">{qLabel}</span>
          </h2>
        </div>
        <div className="hunt-clock__head-right">
          <p className="hunt-clock__pct">
            <span className="hunt-clock__count">{pctRounded}%</span> through the quarter
          </p>
          <p className="hunt-clock__sprint">Sprint to {closeLabel}</p>
        </div>
      </div>

      <div
        className="hunt-clock__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentElapsed)}
        aria-valuetext={`${pctRounded}% through Q${qNumber}, ${daysLeft} ${
          daysLeft === 1 ? 'day' : 'days'
        } remaining`}
      >
        <div className="hunt-clock__bar">
          <div className="hunt-clock__bar-fill" style={{ width: `${fillWidth}%` }} />
          {/*
            One tick per real boundary on the timeline: the kickoff
            (0%), each month-start, and the close (100%). Rendering
            them off the same `months` array we use for the legend
            keeps the bar marks and labels in lockstep across quarters
            of different lengths (Q1=90d, Q2=91d, Q3/Q4=92d).
          */}
          {months.map((m, idx) => (
            <span
              key={`tick-${m.label}`}
              className={`hunt-clock__tick${idx === 0 ? ' hunt-clock__tick--start' : ''}`}
              style={{ left: `${m.pct}%` }}
              aria-hidden="true"
            />
          ))}
          <span
            className="hunt-clock__tick hunt-clock__tick--end"
            style={{ left: '100%' }}
            aria-hidden="true"
          />
          <div
            className="hunt-clock__character"
            style={{ left: `${characterLeft}%` }}
            aria-hidden="true"
          >
            <span className="hunt-clock__character-glow" />
            <img
              className="hunt-clock__character-img"
              src="/axo-running.png"
              alt=""
              draggable={false}
            />
          </div>
        </div>

        <div className="hunt-clock__legend">
          {/*
            Month labels are absolutely positioned at the actual start
            of each month (computed in the useMemo above). The first
            label clamps left-aligned and the last clamps right-aligned
            so they don't overflow the card's edges; the middle one
            centers on its tick.
          */}
          {months.map((m, idx) => (
            <div
              key={m.label}
              // First label clamps left-aligned to 0% so APR doesn't
              // overflow the card's left edge; subsequent labels
              // center on their tick.
              className={`hunt-clock__legend-item${
                idx === 0 ? ' hunt-clock__legend-item--start' : ''
              }`}
              style={{ left: `${m.pct}%` }}
            >
              <p className="hunt-clock__legend-month">{m.label}</p>
            </div>
          ))}
          {/*
            Bookend captions anchored to the bar's true endpoints.
            They sit on a row underneath the month labels so the two
            kinds of information — "which month" vs "what date is the
            quarter boundary" — read as separate layers.
          */}
          <p className="hunt-clock__legend-bookend hunt-clock__legend-bookend--start">
            {qLabel} kickoff · {kickoffLabel}
          </p>
          <p className="hunt-clock__legend-bookend hunt-clock__legend-bookend--end">
            Quarter close · {closeLabel}
          </p>
        </div>
      </div>
    </section>
  );
}

HuntClock.propTypes = {
  now: PropTypes.instanceOf(Date),
};

export default HuntClock;
