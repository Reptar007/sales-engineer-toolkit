import React, { useEffect, useState } from 'react';
import { fetchDashboardCalendar, fetchDashboardLinear } from '../../services/api';
import { MOCK_CALENDAR_EVENTS, MOCK_LINEAR_BOARD } from './dashboardWidgetMockData';
import './DashboardWidgets.less';

const CALENDAR_OPEN_URL = 'https://calendar.google.com';

function DashboardCalendarCard({ events, openUrl = CALENDAR_OPEN_URL, showEmptyHint }) {
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
  const [calendarEvents, setCalendarEvents] = useState(MOCK_CALENDAR_EVENTS);
  const [calendarLive, setCalendarLive] = useState(false);
  const [linearBoard, setLinearBoard] = useState(MOCK_LINEAR_BOARD);

  useEffect(() => {
    let cancelled = false;

    fetchDashboardCalendar()
      .then((data) => {
        if (cancelled || !data) return;
        if (data.configured) {
          setCalendarLive(true);
          setCalendarEvents(Array.isArray(data.events) ? data.events : []);
        }
      })
      .catch(() => {
        /* keep mock */
      });

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
  }, []);

  return (
    <div className="dashboard-widgets">
      <DashboardLinearCard board={linearBoard} />
      <DashboardCalendarCard
        events={calendarEvents}
        showEmptyHint={calendarLive}
      />
    </div>
  );
}

export default DashboardWidgets;
