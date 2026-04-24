import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { LuSunrise, LuSun, LuMoon, LuZap } from 'react-icons/lu';

/**
 * PageHeader
 *
 * Reusable hero-style header for top-level pages (Dashboard, Admin, etc.).
 *
 *   ● THE HUNT CONTINUES                              Team Mario
 *   ☀ Good morning, Sebastian                         Q2 CY2026
 *   Your pack has 4 meetings today, 2 in progress…
 *
 *  - The overline is wolf-themed flavor text (coral) with a small coral dot.
 *  - The greeting auto-adapts to the user's local time of day, with a
 *    matching icon (sunrise / sun / moon).
 *  - The user's name is colored coral; everything else in the heading is
 *    white.
 *  - When `summary` is provided, a wolf-themed status sentence is rendered
 *    below the greeting with coral counts.
 *  - When `team` is provided, a small "Team {name}" chip is anchored to the
 *    right side of the hero, with the team name in coral.
 *
 * Props:
 *   - name      (string, required): user's display name (e.g. first name).
 *   - overline  (string, optional): override the default rotating overline.
 *   - subline   (node,   optional): smaller line under the heading.
 *   - summary   (object, optional): { meetingsToday, inProgress, blocked }
 *                                   counts to surface as a status sentence.
 *   - team      (object, optional): { name, quarter } — rendered on the right
 *                                   side as "Team {name}" + quarter label.
 *   - children  (node,   optional): trailing content rendered to the right
 *                                   of the heading (CTAs, filters, etc.).
 *                                   Ignored when `team` is supplied.
 */

// A pool of wolf-themed overlines; one is chosen per mount so the page feels
// alive without flickering on every re-render.
const OVERLINE_POOL = [
  'THE HUNT CONTINUES',
  'THE PACK IS RUNNING',
  'STAY ON THE SCENT',
  'EYES ON THE PRIZE',
  'NO PROSPECT LEFT BEHIND',
  'STRENGTH IN THE PACK',
];

function getTimeOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

const GREETINGS = {
  morning: { label: 'Good morning', Icon: LuSunrise },
  afternoon: { label: 'Good afternoon', Icon: LuSun },
  evening: { label: 'Good evening', Icon: LuMoon },
};

// Build a wolf-themed sentence from the {meetingsToday, inProgress, blocked}
// counts. Returns null when there's nothing meaningful to say (e.g. all zero
// or summary not yet ready).
function renderSummarySentence(summary) {
  // Stay silent until the hook reports ready, so we don't flash an
  // "all clear" sentence before the counts come in.
  if (!summary || summary.ready === false) return null;
  const { meetingsToday = 0, inProgress = 0, blocked = 0 } = summary;
  const parts = [];

  if (meetingsToday > 0) {
    parts.push(
      <React.Fragment key="m">
        <span className="page-header__count">{meetingsToday}</span>{' '}
        {meetingsToday === 1 ? 'meeting' : 'meetings'} today
      </React.Fragment>,
    );
  }
  if (inProgress > 0) {
    parts.push(
      <React.Fragment key="p">
        <span className="page-header__count">{inProgress}</span>{' '}
        {inProgress === 1 ? 'hunt' : 'hunts'} in progress
      </React.Fragment>,
    );
  }
  if (blocked > 0) {
    parts.push(
      <React.Fragment key="b">
        <span className="page-header__count">{blocked}</span>{' '}
        {blocked === 1 ? 'blocker' : 'blockers'} to clear
      </React.Fragment>,
    );
  }

  if (parts.length === 0) {
    return (
      <p className="page-header__summary">
        Your pack is clear — no meetings, no open hunts, no blockers right now.
      </p>
    );
  }

  // Stitch the parts into prose: "A, B, and C."
  const stitched = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      stitched.push(
        i === parts.length - 1 && parts.length > 1 ? ', and ' : ', ',
      );
    }
    stitched.push(part);
  });

  return (
    <p className="page-header__summary">
      Your pack has {stitched}.
    </p>
  );
}

function PageHeader({ name, overline, subline, summary, team, children }) {
  // Pick a random overline once per mount, unless the caller passed one in.
  const chosenOverline = useMemo(() => {
    if (overline) return overline;
    return OVERLINE_POOL[Math.floor(Math.random() * OVERLINE_POOL.length)];
  }, [overline]);

  const { label, Icon } = GREETINGS[getTimeOfDay()];
  const displayName = name?.trim() || 'wolf';

  // Split the team name into "{prefix} {rest}" so the first word can be
  // rendered in white as a label (e.g. "Team") and the remainder in coral
  // as the actual team identity (e.g. "Mario"). Single-word team names
  // fall back to rendering the whole name in coral.
  const teamParts = useMemo(() => {
    const raw = team?.name?.trim();
    if (!raw) return null;
    const idx = raw.indexOf(' ');
    if (idx === -1) return { prefix: '', rest: raw };
    return { prefix: raw.slice(0, idx), rest: raw.slice(idx + 1) };
  }, [team?.name]);

  return (
    <header className="page-header">
      {/*
        Overline lives above the two-column row so the greeting and
        the team chip can share the exact same starting baseline.
      */}
      <div className="page-header__overline">
        <span className="page-header__overline-dot" aria-hidden="true" />
        {chosenOverline}
      </div>
      <div className="page-header__main">
        <div className="page-header__text">
          <h1 className="page-header__title">
            <Icon className="page-header__title-icon" aria-hidden="true" />
            <span>
              {label}, <span className="page-header__name">{displayName}</span>
            </span>
          </h1>
          {subline && <p className="page-header__sub">{subline}</p>}
          {renderSummarySentence(summary)}
        </div>
        {teamParts ? (
          <div className="page-header__team" aria-label={team.name}>
            <p className="page-header__team-line">
              {teamParts.prefix && <>{teamParts.prefix} </>}
              <span className="page-header__team-name">{teamParts.rest}</span>
            </p>
            {(team.quarter || summary?.inProgress != null) && (
              <div className="page-header__team-meta">
                {team.quarter && (
                  <span className="page-header__team-quarter">
                    {team.quarter}
                  </span>
                )}
                {summary?.inProgress != null && (
                  <span
                    className="page-header__active-pill"
                    aria-label={`${summary.inProgress} active hunts`}
                  >
                    <LuZap
                      className="page-header__active-pill-icon"
                      aria-hidden="true"
                    />
                    {summary.inProgress} active{' '}
                    {summary.inProgress === 1 ? 'hunt' : 'hunts'}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          children && <div className="page-header__actions">{children}</div>
        )}
      </div>
    </header>
  );
}

PageHeader.propTypes = {
  name: PropTypes.string,
  overline: PropTypes.string,
  subline: PropTypes.node,
  summary: PropTypes.shape({
    meetingsToday: PropTypes.number,
    inProgress: PropTypes.number,
    blocked: PropTypes.number,
    ready: PropTypes.bool,
  }),
  team: PropTypes.shape({
    name: PropTypes.string,
    quarter: PropTypes.string,
  }),
  children: PropTypes.node,
};

export default PageHeader;
