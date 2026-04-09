import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchDashboardCalendar,
  fetchDashboardLinear,
  startGoogleCalendarOAuth,
  disconnectGoogleCalendar,
} from '../../services/api';
import { MOCK_LINEAR_BOARD } from './dashboardWidgetMockData';
import './DashboardWidgets.less';

const CALENDAR_OPEN_URL = 'https://calendar.google.com';

function DashboardCalendarCard({
  events,
  openUrl = CALENDAR_OPEN_URL,
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
          <span className="dashboard-panel__badge">New</span>
        </h2>
        <a
          className="dashboard-panel__link"
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open
        </a>
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

function DashboardLinearCard({ board = MOCK_LINEAR_BOARD }) {
  const projects = board.projects ?? [];

  return (
    <section className="dashboard-panel" aria-labelledby="dash-linear-title">
      <div className="dashboard-panel__head">
        <h2 className="dashboard-panel__title" id="dash-linear-title">
          Linear workload
          <span className="dashboard-panel__badge">New</span>
        </h2>
        <a
          className="dashboard-panel__link"
          href={board.openUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open
        </a>
      </div>
      <div className="dashboard-linear__projects">
        {projects.map((project) => (
          <div key={project.id} className="dashboard-linear__project">
            <h3 className="dashboard-linear__project-name">
              {project.name}
              <span className="dashboard-linear__project-count">
                {project.issues?.length ?? 0}{' '}
                {(project.issues?.length ?? 0) === 1 ? 'issue' : 'issues'}
              </span>
            </h3>
            <ul className="dashboard-linear__issue-list">
              {(project.issues ?? []).map((issue) => (
                <li key={issue.id} className="dashboard-linear__row">
                  <p className="dashboard-linear__task">{issue.title}</p>
                  <span
                    className={`dashboard-linear__status dashboard-linear__status--${issue.tone}`}
                  >
                    {issue.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardWidgets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLive, setCalendarLive] = useState(false);
  const [calendarSource, setCalendarSource] = useState(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [linearBoard, setLinearBoard] = useState(MOCK_LINEAR_BOARD);

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

  useEffect(() => {
    let cancelled = false;

    loadCalendar().catch(() => {});

    fetchDashboardLinear()
      .then((data) => {
        if (cancelled || !data) return;
        if (data.configured && Array.isArray(data.projects)) {
          setLinearBoard({
            openUrl: data.openUrl || MOCK_LINEAR_BOARD.openUrl,
            projects: data.projects,
          });
        }
      })
      .catch(() => {
        /* keep mock */
      });

    return () => {
      cancelled = true;
    };
  }, [loadCalendar]);

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
      <DashboardLinearCard board={linearBoard} />
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
