import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  fetchDashboardCalendar,
  fetchDashboardLinear,
  startGoogleCalendarOAuth,
  disconnectGoogleCalendar,
} from '../../services/api';
import { MOCK_LINEAR_BOARD } from './dashboardWidgetMockData';
import './DashboardWidgets.less';

const LINEAR_DEFAULT_OPEN_URL = MOCK_LINEAR_BOARD.openUrl;

const LINEAR_INITIAL_STATE = {
  status: 'loading',
  openUrl: LINEAR_DEFAULT_OPEN_URL,
  projects: [],
};

function DashboardCalendarCard({
  events,
  showEmptyHint,
  showConnect,
  onConnect,
  onDisconnect,
  connectLoading,
  oauthConnected,
}) {
  return (
    <section className="dashboard-panel" aria-labelledby="dash-cal-title">
      <div className="dashboard-panel__head">
        <h2 className="dashboard-panel__title" id="dash-cal-title">
          Today&apos;s calendar
        </h2>
      </div>
      <div className="dashboard-calendar">
        {events.length === 0 && showEmptyHint ? (
          <p className="dashboard-calendar__empty">No events scheduled today.</p>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="dashboard-calendar__item">
              <span
                className="dashboard-calendar__dot"
                style={{ background: ev.color }}
                aria-hidden
              />
              <div>
                <p className="dashboard-calendar__time">{ev.time}</p>
                <p className="dashboard-calendar__title">{ev.title}</p>
                <p className="dashboard-calendar__meta">{ev.meta}</p>
              </div>
            </div>
          ))
        )}
      </div>
      {(showConnect || oauthConnected) && (
        <div className="dashboard-calendar__actions">
          {showConnect && (
            <button
              type="button"
              className="dashboard-calendar__btn dashboard-calendar__btn--primary"
              disabled={connectLoading}
              onClick={onConnect}
            >
              {connectLoading ? 'Redirecting…' : 'Connect Google Calendar'}
            </button>
          )}
          {oauthConnected && (
            <button type="button" className="dashboard-calendar__btn" onClick={onDisconnect}>
              Disconnect Google
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function LinearCallout({ title, message, action }) {
  return (
    <div className="dashboard-linear__callout">
      {title && <p className="dashboard-linear__callout-title">{title}</p>}
      <p className="dashboard-linear__callout-message">{message}</p>
      {action}
    </div>
  );
}

// Linear issues commonly follow the convention "Opp Name — ask description"
// (or "Opp Name: ask"). Split on the first separator we recognize so the
// table can render the opportunity name on the primary line and the
// underlying ask as a secondary "↳" sub-line. Falls back to the full
// title as the opportunity name when no separator is found.
const HUNT_TITLE_SEPARATORS = [' — ', ' – ', ' - ', ': '];

function parseHuntTitle(title) {
  const raw = (title || '').trim();
  if (!raw) return { opp: 'Untitled hunt', ask: '' };
  for (const sep of HUNT_TITLE_SEPARATORS) {
    const idx = raw.indexOf(sep);
    if (idx > 0) {
      return {
        opp: raw.slice(0, idx).trim(),
        ask: raw.slice(idx + sep.length).trim(),
      };
    }
  }
  return { opp: raw, ask: '' };
}

// Flatten the project-grouped Linear payload into a single ordered list of
// rows for the table view. Each row is tagged with its project name so
// the Project column can render a per-row pill.
function flattenHuntRows(projects) {
  if (!Array.isArray(projects)) return [];
  const rows = [];
  for (const project of projects) {
    for (const issue of project.issues ?? []) {
      rows.push({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        tone: issue.tone,
        ae: issue.ae ?? null,
        dueDate: issue.dueDate ?? null,
        oppName: issue.oppName ?? null,
        typeOfAsk: issue.typeOfAsk ?? null,
        accountScore: issue.accountScore ?? null,
        priority: issue.priority ?? null,
        isAiDemo: Boolean(issue.isAiDemo),
        projectName: project.name,
      });
    }
  }
  return rows;
}

// Pick the strings rendered in the Opportunity column. Prefer the
// structured `oppName` / `typeOfAsk` extracted from the issue's SE
// template description; fall back to title parsing when the issue
// hasn't been filled in with the template (legacy / ad-hoc tickets).
function resolveHuntDisplay(row) {
  if (row.oppName || row.typeOfAsk) {
    return {
      opp: row.oppName || row.title || 'Untitled hunt',
      ask: row.typeOfAsk || '',
    };
  }
  return parseHuntTitle(row.title);
}

// Format a Linear `dueDate` (YYYY-MM-DD or ISO string) into the short
// "MMM D" representation used in the table. Falls back to the raw value
// when the input can't be parsed so manually-typed strings still surface.
function formatDueDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Linear `dueDate` is a date-only string; appending a time keeps it
  // anchored to local TZ so we don't render the day-before in negative
  // UTC offsets.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00`)
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Tiny robot glyph used inside the AI Demo status pill. Pure outline so
// it inherits the pill's pink text color via `currentColor`.
function RobotGlyph() {
  return (
    <svg
      className="dashboard-linear__status-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M12 4v4" />
      <circle cx="12" cy="3" r="1" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
      <path d="M9 17h6" />
      <path d="M2 13v3" />
      <path d="M22 13v3" />
    </svg>
  );
}

// Compact Linear glyph used in the source-pill at the top-right of the
// hunts panel. Mirrors the SALESFORCE pill on the Salesforce widget.
function LinearGlyph() {
  return (
    <svg
      className="dashboard-source-pill__icon"
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M1.22 61.27 38.73 98.78a50.05 50.05 0 0 1-37.5-37.51zm-1.16-13.7L52.43 99.94a50.41 50.41 0 0 0 11.93-2.42L2.48 35.64A50.41 50.41 0 0 0 .06 47.57zM6.16 26.05 73.95 93.84a50.36 50.36 0 0 0 9.4-7.08L13.24 16.65a50.36 50.36 0 0 0-7.08 9.4zm10.5-12.81L86.76 83.34a50 50 0 1 0-70.1-70.1z"
      />
    </svg>
  );
}

function DashboardLinearCard({ state }) {
  const { status, projects } = state;

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <p className="dashboard-linear__callout-message">Loading your hunts…</p>
      );
    }

    if (status === 'needs_profile') {
      return (
        <LinearCallout
          title="Connect your Linear account"
          message="Link your Linear identity so your dashboard shows issues assigned to you."
          action={
            <Link to="/profile" className="dashboard-calendar__btn dashboard-calendar__btn--primary">
              Go to Profile
            </Link>
          }
        />
      );
    }

    if (status === 'no_sales_engineer') {
      return (
        <LinearCallout
          title="Account not set up"
          message="Your account isn't configured as a Sales Engineer yet. Ask an admin to add you to a team."
        />
      );
    }

    if (status === 'unavailable') {
      return (
        <LinearCallout
          title="Linear is temporarily unavailable"
          message="We couldn't reach Linear just now. Try refreshing in a minute."
        />
      );
    }

    const rows = flattenHuntRows(projects);

    if (status === 'ok' && rows.length === 0) {
      return (
        <LinearCallout
          title="You're all caught up"
          message="No open hunts assigned to you right now."
        />
      );
    }

    return (
      <div className="dashboard-hunts">
        <table className="dashboard-hunts__table">
          <colgroup>
            <col className="dashboard-hunts__col--opp" />
            <col className="dashboard-hunts__col--ae" />
            <col className="dashboard-hunts__col--due" />
            <col className="dashboard-hunts__col--score" />
            <col className="dashboard-hunts__col--status" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="dashboard-hunts__th">Opportunity</th>
              <th scope="col" className="dashboard-hunts__th">AE</th>
              <th scope="col" className="dashboard-hunts__th">Due Date</th>
              <th scope="col" className="dashboard-hunts__th">Score</th>
              <th scope="col" className="dashboard-hunts__th">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { opp, ask } = resolveHuntDisplay(row);
              const dueLabel = formatDueDate(row.dueDate);
              // AI Demo takes precedence over priority highlighting so
              // demo work always reads as "demo" rather than red/orange.
              let rowModifier = '';
              let rowTitle;
              if (row.isAiDemo) {
                rowModifier = ' dashboard-hunts__row--ai-demo';
                rowTitle = 'AI Demo';
              } else if (row.priority === 'urgent' || row.priority === 'high') {
                rowModifier = ` dashboard-hunts__row--${row.priority}`;
                rowTitle = row.priority === 'urgent' ? 'Urgent priority' : 'High priority';
              }
              return (
                <tr
                  key={row.id}
                  className={`dashboard-hunts__row${rowModifier}`}
                  title={rowTitle}
                >
                  <td className="dashboard-hunts__cell dashboard-hunts__cell--opp">
                    <p className="dashboard-hunts__opp" title={opp}>{opp}</p>
                    {ask && (
                      <p className="dashboard-hunts__ask" title={ask}>
                        <span className="dashboard-hunts__ask-arrow" aria-hidden="true">↳</span>
                        <span className="dashboard-hunts__ask-text">{ask}</span>
                      </p>
                    )}
                  </td>
                  <td
                    className={`dashboard-hunts__cell dashboard-hunts__cell--ae${
                      row.ae ? '' : ' dashboard-hunts__cell--muted'
                    }`}
                    title={row.ae || undefined}
                  >
                    {row.ae || '—'}
                  </td>
                  <td
                    className={`dashboard-hunts__cell dashboard-hunts__cell--due${
                      dueLabel ? '' : ' dashboard-hunts__cell--muted'
                    }`}
                    title={dueLabel || undefined}
                  >
                    {dueLabel || '—'}
                  </td>
                  <td className="dashboard-hunts__cell dashboard-hunts__cell--score">
                    {row.accountScore ? (
                      <span
                        className={`dashboard-hunts__score dashboard-hunts__score--${row.accountScore
                          .trim()
                          .charAt(0)
                          .toLowerCase()}`}
                        title={`Account Score: ${row.accountScore}`}
                      >
                        {row.accountScore}
                      </span>
                    ) : (
                      <span className="dashboard-hunts__cell--muted">—</span>
                    )}
                  </td>
                  <td className="dashboard-hunts__cell dashboard-hunts__cell--status">
                    <span
                      className={`dashboard-linear__status dashboard-linear__status--${row.tone}`}
                      title={row.status}
                    >
                      {row.tone === 'ai-demo' && <RobotGlyph />}
                      <span className="dashboard-linear__status-label">{row.status}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <section className="dashboard-panel" aria-labelledby="dash-linear-title">
      <div className="dashboard-panel__head">
        <div className="dashboard-panel__head-text">
          <h2 className="dashboard-panel__title" id="dash-linear-title">
            Active Hunts
          </h2>
        </div>
        <span className="dashboard-source-pill dashboard-source-pill--linear">
          <LinearGlyph />
          Linear
        </span>
      </div>
      {renderBody()}
    </section>
  );
}

export function DashboardWidgets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLive, setCalendarLive] = useState(false);
  const [calendarSource, setCalendarSource] = useState(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [linearState, setLinearState] = useState(LINEAR_INITIAL_STATE);

  const loadCalendar = useCallback(async () => {
    try {
      const data = await fetchDashboardCalendar();
      if (!data) return;
      if (data.configured) {
        setCalendarLive(true);
        setCalendarEvents(Array.isArray(data.events) ? data.events : []);
        setCalendarSource(data.source ?? null);
      } else {
        setCalendarLive(false);
        setCalendarEvents([]);
        setCalendarSource(null);
      }
    } catch {
      setCalendarLive(false);
      setCalendarEvents([]);
      setCalendarSource(null);
    }
  }, []);

  // Force-mock toggle for previewing the Active Hunts table without
  // depending on real Linear data. Triggered by either:
  //   - URL param: `?mock_hunts=1` (handy for one-off screenshots)
  //   - localStorage: `dashboardMockHunts=1` (sticks across reloads)
  // Dev-only so it can never accidentally swap real data in prod.
  const previewMockHunts =
    import.meta.env.DEV &&
    (searchParams.get('mock_hunts') === '1' ||
      (typeof window !== 'undefined' &&
        window.localStorage?.getItem('dashboardMockHunts') === '1'));

  useEffect(() => {
    let cancelled = false;

    loadCalendar().catch(() => {});

    // In dev, fall back to MOCK_LINEAR_BOARD whenever the backend can't
    // surface real data (Linear unconfigured, request failed, empty
    // payload), OR whenever the dev-only `previewMockHunts` toggle is
    // on. This lets us iterate on the table layout without standing up
    // Linear locally. Production keeps the original callouts so users
    // see real connect/error states.
    const withMockFallback = (currentState, openUrl) => {
      if (!import.meta.env.DEV) return currentState;
      return {
        status: 'ok',
        openUrl: openUrl || LINEAR_DEFAULT_OPEN_URL,
        projects: MOCK_LINEAR_BOARD.projects,
      };
    };

    if (previewMockHunts) {
      setLinearState({
        status: 'ok',
        openUrl: LINEAR_DEFAULT_OPEN_URL,
        projects: MOCK_LINEAR_BOARD.projects,
      });
      return () => {
        cancelled = true;
      };
    }

    fetchDashboardLinear()
      .then((data) => {
        if (cancelled || !data) return;
        const openUrl = data.openUrl || LINEAR_DEFAULT_OPEN_URL;
        if (data.configured && Array.isArray(data.projects) && data.projects.length > 0) {
          setLinearState({ status: 'ok', openUrl, projects: data.projects });
        } else if (data.needsLinearProfile) {
          setLinearState(
            withMockFallback({ status: 'needs_profile', openUrl, projects: [] }, openUrl),
          );
        } else if (data.reason === 'no_sales_engineer') {
          setLinearState(
            withMockFallback({ status: 'no_sales_engineer', openUrl, projects: [] }, openUrl),
          );
        } else if (data.configured && Array.isArray(data.projects)) {
          setLinearState({ status: 'ok', openUrl, projects: data.projects });
        } else {
          setLinearState(
            withMockFallback({ status: 'unavailable', openUrl, projects: [] }, openUrl),
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLinearState(
          withMockFallback(
            {
              status: 'unavailable',
              openUrl: LINEAR_DEFAULT_OPEN_URL,
              projects: [],
            },
            LINEAR_DEFAULT_OPEN_URL,
          ),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [loadCalendar, previewMockHunts]);

  useEffect(() => {
    const g = searchParams.get('google_calendar');
    if (g == null) return;
    loadCalendar();
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('google_calendar');
        return p;
      },
      { replace: true },
    );
  }, [searchParams, loadCalendar, setSearchParams]);

  const handleConnectGoogle = async () => {
    setConnectLoading(true);
    try {
      const data = await startGoogleCalendarOAuth();
      if (data?.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Could not start Google Calendar connection');
    } finally {
      setConnectLoading(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    try {
      await disconnectGoogleCalendar();
      await loadCalendar();
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Could not disconnect');
    }
  };

  const showConnect = !calendarLive;
  const oauthConnected = calendarSource === 'oauth';

  return (
    <div className="dashboard-widgets">
      <DashboardLinearCard state={linearState} />
      <DashboardCalendarCard
        events={calendarEvents}
        showEmptyHint={calendarLive}
        showConnect={showConnect}
        onConnect={handleConnectGoogle}
        onDisconnect={handleDisconnectGoogle}
        connectLoading={connectLoading}
        oauthConnected={oauthConnected}
      />
    </div>
  );
}

export default DashboardWidgets;
