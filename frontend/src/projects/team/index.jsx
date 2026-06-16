import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import {
  LuArrowLeft,
  LuCalendar,
  LuChevronDown,
  LuCircleCheck,
  LuExternalLink,
  LuFilePlus,
  LuInbox,
  LuRuler,
  LuSparkles,
} from 'react-icons/lu';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchPackCarr,
  fetchPackOverview,
  fetchPackSeCalendar,
  fetchPackSeTickets,
} from '../../services/api';
import OwnTeamView from './OwnTeamView';
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
  'team-kirby': {
    src: '/kirby_header.png',
    alt: 'Kirby in a pink hoodie at a gaming setup',
  },
  'team-sonic': {
    src: '/sonic_header.png',
    alt: 'Sonic bench-pressing 300 lbs in a QA Wolf tracksuit',
  },
  'team-bowser': {
    src: '/bowser_header.png',
    alt: 'Bowser snowboarding in tactical gear on a Chronic-branded board',
  },
  'team-zelda': {
    src: '/zelda_header.png',
    alt: 'Link leaning on a Chronic-branded supercar with sword on his back',
  },
};

// Calendar helpers for the year/quarter scope controls.
function getCurrentYear() {
  return new Date().getFullYear();
}

// Years offered in the scope dropdown: current year and the two prior.
const AVAILABLE_YEARS = [getCurrentYear(), getCurrentYear() - 1, getCurrentYear() - 2];

// `quarter` of 0 means "full year"; 1-4 selects a specific quarter. The
// report's roll-ups are keyed like "Q2 CY2026", so build that on demand.
function buildQuarterKey(year, quarter) {
  return quarter ? `Q${quarter} CY${year}` : null;
}

// Human label for the active scope — "Q2 2026" or just "2026".
function buildPeriodLabel(year, quarter) {
  return quarter ? `Q${quarter} ${year}` : `${year}`;
}

// Compact USD for the CARR breakdown: $1.2M / $540K / $0. Keeps the bars
// readable without long, comma-heavy numbers.
function formatCompactUSD(amount) {
  const n = Number(amount) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// Grouped bar chart geometry. The viewBox is fixed in user-space units
// and CSS scales the SVG to fill its container, so tweaks here reflow
// automatically without touching the JSX.
const CHART = { w: 760, h: 340, padTop: 16, padRight: 12, padBottom: 56, padLeft: 40 };

// The three series rendered per SE group, in draw order (left→right).
// Each `key` matches a field on the computed pack rows and a `--{key}`
// color modifier in the LESS.
const CHART_SERIES = [
  { key: 'creation', label: 'Creation' },
  { key: 'scoping', label: 'Scoping' },
  { key: 'completed', label: 'Completed' },
];

// Human labels + accent class for each closed-ticket category the
// backend classifier emits. Shared by the drill-down ticket-list chips
// so the categories read the same as the chart legend.
const CATEGORY_META = {
  creation: { label: 'Creation', cls: 'creation' },
  estimation: { label: 'Scoping', cls: 'scoping' },
  aiDemo: { label: 'AI Demo', cls: 'aidemo' },
  other: { label: 'Other', cls: 'other' },
};

// Map a Linear `completedAt` ISO date to the report's quarter key
// ("Q2 CY2026") so the drill-down ticket list can be filtered to the
// active quarter the same way the headline tiles are.
function quarterKeyOf(dateString) {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth() + 1;
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${quarter} CY${d.getUTCFullYear()}`;
}

// Format an ISO date as a short "Apr 28" label for the ticket rows.
function formatShortDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Whole-day difference between a "YYYY-MM-DD" due date and today, treating
// both as calendar dates (no time-of-day). Negative = overdue. Linear due
// dates are date-only and parse as UTC midnight, so we compare against
// today's local calendar date pinned to the same UTC-midnight basis.
function daysUntil(dateString) {
  const due = new Date(dateString);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dueMs = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((dueMs - todayMs) / 86400000);
}

// Build the due-date label + urgency tone for a ticket row. Open tickets
// get relative wording ("Due today", "Due in 3 days", "Overdue") when the
// deadline is near; everything else (and all closed tickets) falls back to
// the absolute "Due Apr 28" form.
function describeDue(dateString, relative) {
  const abs = formatShortDate(dateString);
  if (!abs) return null;
  if (!relative) return { text: `Due ${abs}`, tone: 'default' };
  const days = daysUntil(dateString);
  if (days === null) return { text: `Due ${abs}`, tone: 'default' };
  if (days < 0) return { text: 'Overdue', tone: 'overdue' };
  if (days === 0) return { text: 'Due today', tone: 'today' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (days <= 3) return { text: `Due in ${days} days`, tone: 'soon' };
  return { text: `Due ${abs}`, tone: 'default' };
}

// Map a Linear workflow-state name to a color tone for its status pill.
// Keyword-matched (rather than exact) so custom/renamed states still land
// in a sensible bucket; unknown states fall back to a neutral pill.
function statusTone(status) {
  const s = (status || '').toLowerCase();
  if (!s) return 'default';
  if (/cancel/.test(s)) return 'canceled';
  if (/(done|complete|shipped|merged|closed)/.test(s)) return 'done';
  if (/(block|stuck|wait|hold|paused)/.test(s)) return 'blocked';
  if (/(review|qa|testing)/.test(s)) return 'review';
  if (/(progress|doing|started|active|build)/.test(s)) return 'progress';
  if (/(todo|to do|ready|unstarted)/.test(s)) return 'todo';
  if (/(backlog|triage)/.test(s)) return 'backlog';
  return 'default';
}

// Round the data max up to a "nice" y-axis ceiling so tick marks land
// on whole numbers rather than awkward fractions. Floors at 5 so a
// pack with a single ticket still has headroom above the bar.
function niceChartMax(value) {
  const v = Math.max(1, Math.ceil(value));
  if (v <= 5) return 5;
  if (v <= 10) return 10;
  if (v <= 20) return 20;
  if (v <= 50) return Math.ceil(v / 10) * 10;
  if (v <= 100) return Math.ceil(v / 20) * 20;
  return Math.ceil(v / 50) * 50;
}

// Integer y-axis ladder snapped so small ceilings don't show fractional
// gridlines. yMax=5 → [0..5]; yMax=10 → [0,2,4,6,8,10]; larger → 5 ticks.
function buildYTicks(yMax) {
  if (yMax <= 5) {
    return Array.from({ length: yMax + 1 }, (_, i) => i);
  }
  if (yMax <= 10) {
    return [0, 2, 4, 6, 8, 10].filter((v) => v <= yMax);
  }
  return [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(p * yMax));
}

// A single ticket row in the drill-down list: a category chip, the title
// (deep-linked to Linear when a URL is present), the project, and an
// optional date (completion date for closed tickets).
function TicketRow({ ticket, dateLabel, dueRelative }) {
  const meta = CATEGORY_META[ticket.category] || CATEGORY_META.other;
  const due = describeDue(ticket.dueDate, dueRelative);
  return (
    <li className="team-tickets__row">
      <span className={`team-tickets__chip team-tickets__chip--${meta.cls}`}>{meta.label}</span>
      <div className="team-tickets__main">
        {ticket.url ? (
          <a className="team-tickets__title" href={ticket.url} target="_blank" rel="noreferrer">
            <span className="team-tickets__title-text">{ticket.title}</span>
            <LuExternalLink className="team-tickets__title-icon" aria-hidden="true" />
          </a>
        ) : (
          <span className="team-tickets__title">
            <span className="team-tickets__title-text">{ticket.title}</span>
          </span>
        )}
        {ticket.project && <span className="team-tickets__project">{ticket.project}</span>}
      </div>
      <div className="team-tickets__side">
        {ticket.status && (
          <span
            className={`team-tickets__status team-tickets__status--${statusTone(ticket.status)}`}
          >
            {ticket.status}
          </span>
        )}
        {due && (
          <span className={`team-tickets__due team-tickets__due--${due.tone}`}>
            <LuCalendar className="team-tickets__due-icon" aria-hidden="true" />
            {due.text}
          </span>
        )}
        {dateLabel && <span className="team-tickets__date">{dateLabel}</span>}
      </div>
    </li>
  );
}

// Does a ticket pass the active column filters? Pure so it can be used
// inside memo selectors without becoming a dependency itself.
function ticketMatchesFilters(t, f) {
  if (f.category && (t.category || 'other') !== f.category) return false;
  if (f.project && t.project !== f.project) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.q && !(t.title || '').toLowerCase().includes(f.q.trim().toLowerCase())) return false;
  return true;
}

// Hide all-day blocks that aren't out-of-office (focus time, "Home",
// lunch, etc.) — mirrors the dashboard's own calendar card so the team
// drill-down reads the same way. OOO blocks are kept so a lead can spot
// who's out today.
function isVisibleCalendarEvent(ev) {
  if (ev?.isAllDay && !ev?.isOoo) return false;
  return true;
}

// Today's calendar for the drilled-into SE. Reuses the global
// `dashboard-calendar` styles so it matches the homepage calendar card.
// Soft states: loading, not-connected (SE hasn't linked Google), empty.
function SeCalendar({ payload, error }) {
  if (error) {
    return (
      <p className="team-page__linear-hint">
        Couldn&apos;t load this SE&apos;s calendar right now.
      </p>
    );
  }
  if (!payload) {
    return <p className="team-page__linear-hint">Loading calendar…</p>;
  }
  const firstName = payload.name?.split(/\s+/)[0] || 'This SE';
  if (!payload.configured) {
    return (
      <p className="team-page__linear-hint">
        {firstName} hasn&apos;t connected their Google Calendar.
      </p>
    );
  }
  const events = (payload.events || []).filter(isVisibleCalendarEvent);
  if (events.length === 0) {
    return <p className="team-page__linear-hint">No events scheduled today.</p>;
  }
  return (
    <div className="dashboard-calendar">
      {events.map((ev) => (
        <div key={ev.id} className="dashboard-calendar__item">
          <span className="dashboard-calendar__dot" style={{ background: ev.color }} aria-hidden />
          <div className="dashboard-calendar__body">
            <p className="dashboard-calendar__heading">
              <span className="dashboard-calendar__time">{ev.time}</span>
              <span className="dashboard-calendar__title">{ev.title}</span>
            </p>
            <p className="dashboard-calendar__meta">{ev.meta}</p>
          </div>
          {(ev.attendeeCount > 0 || ev.videoUrl) && (
            <div className="dashboard-calendar__row-actions">
              {ev.attendeeCount > 0 && (
                <span
                  className="dashboard-calendar__chip"
                  title={`${ev.attendeeCount} ${ev.attendeeCount === 1 ? 'attendee' : 'attendees'}`}
                >
                  {ev.attendeeCount}
                </span>
              )}
              {ev.videoUrl && (
                <a
                  className="dashboard-calendar__join"
                  href={ev.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={ev.videoProvider ? `Join via ${ev.videoProvider}` : 'Join video call'}
                >
                  Join
                </a>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// The two ticket lists shown beneath the headline tiles in the drill-down:
// the SE's live open workload and the tickets they completed in the active
// scope. Owns a column filter bar (title search + category / project /
// status) that narrows both lists at once, plus its own loading / error /
// empty states so the parent JSX stays flat.
function TicketLists({ error, loaded, open, closed, periodLabel }) {
  // The completed list can get long, so it's a collapsible disclosure the
  // lead can fold away. Defaults open; collapsing is purely cosmetic.
  const [closedExpanded, setClosedExpanded] = useState(true);
  const [filters, setFilters] = useState({ q: '', category: '', project: '', status: '' });

  // Dropdown options, derived from the union of both lists so a value the
  // lead picks always matches at least one row somewhere on the page.
  const options = useMemo(() => {
    const all = [...open, ...closed];
    const seenCat = new Set();
    const categories = [];
    for (const t of all) {
      const key = t.category || 'other';
      if (!seenCat.has(key)) {
        seenCat.add(key);
        categories.push({ value: key, label: (CATEGORY_META[key] || CATEGORY_META.other).label });
      }
    }
    const uniq = (vals) =>
      Array.from(new Set(vals.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return {
      categories: categories.sort((a, b) => a.label.localeCompare(b.label)),
      projects: uniq(all.map((t) => t.project)),
      statuses: uniq(all.map((t) => t.status)),
    };
  }, [open, closed]);

  const filteredOpen = useMemo(
    () => open.filter((t) => ticketMatchesFilters(t, filters)),
    [open, filters],
  );
  const filteredClosed = useMemo(
    () => closed.filter((t) => ticketMatchesFilters(t, filters)),
    [closed, filters],
  );

  if (error) {
    return (
      <p className="team-page__linear-hint">
        Couldn&apos;t load this SE&apos;s tickets right now. Try refreshing in a minute.
      </p>
    );
  }
  if (!loaded) {
    return <p className="team-page__linear-hint">Loading tickets…</p>;
  }

  const closedHeading = `Completed in ${periodLabel}`;

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const anyActive = Boolean(filters.q || filters.category || filters.project || filters.status);

  return (
    <div className="team-tickets">
      <div className="team-tickets__filters">
        <input
          type="search"
          className="team-tickets__search"
          placeholder="Search title…"
          aria-label="Search ticket titles"
          value={filters.q}
          onChange={(e) => setFilter('q', e.target.value)}
        />
        <select
          className="team-tickets__select"
          aria-label="Filter by category"
          value={filters.category}
          onChange={(e) => setFilter('category', e.target.value)}
        >
          <option value="">All categories</option>
          {options.categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="team-tickets__select"
          aria-label="Filter by project"
          value={filters.project}
          onChange={(e) => setFilter('project', e.target.value)}
        >
          <option value="">All projects</option>
          {options.projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="team-tickets__select"
          aria-label="Filter by status"
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
        >
          <option value="">All statuses</option>
          {options.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {anyActive && (
          <button
            type="button"
            className="team-tickets__clear"
            onClick={() => setFilters({ q: '', category: '', project: '', status: '' })}
          >
            Clear filters
          </button>
        )}
      </div>

      <section className="team-tickets__group">
        <h3 className="team-tickets__heading">
          Open workload <span className="team-tickets__count">{filteredOpen.length}</span>
        </h3>
        {open.length === 0 ? (
          <p className="team-tickets__empty">Nothing open right now.</p>
        ) : filteredOpen.length === 0 ? (
          <p className="team-tickets__empty">No open tickets match these filters.</p>
        ) : (
          <ul className="team-tickets__list">
            {filteredOpen.map((t) => (
              <TicketRow key={t.id} ticket={t} dateLabel={null} dueRelative />
            ))}
          </ul>
        )}
      </section>

      <section className="team-tickets__group">
        <button
          type="button"
          className="team-tickets__toggle"
          aria-expanded={closedExpanded}
          onClick={() => setClosedExpanded((v) => !v)}
        >
          <LuChevronDown
            className={`team-tickets__toggle-icon ${closedExpanded ? 'is-open' : ''}`}
            aria-hidden="true"
          />
          <span className="team-tickets__heading-text">{closedHeading}</span>
          <span className="team-tickets__count">{filteredClosed.length}</span>
        </button>
        {closedExpanded &&
          (closed.length === 0 ? (
            <p className="team-tickets__empty">No completed tickets in this window.</p>
          ) : filteredClosed.length === 0 ? (
            <p className="team-tickets__empty">No completed tickets match these filters.</p>
          ) : (
            <ul className="team-tickets__list">
              {filteredClosed.map((t) => (
                <TicketRow key={t.id} ticket={t} dateLabel={formatShortDate(t.completedAt)} />
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}

/**
 * TeamPage — "Team Mario", "Team Yoshi", … with two role-based views.
 *
 * SE leads get the "Pack" overview: a grouped bar chart of every active
 * Sales Engineer's Creation / Scoping / Completed Linear tickets, scoped to
 * the whole year or the current quarter. Clicking an SE's bar group drills
 * into a high-level detail panel (their live workload + closed breakdown).
 * The pack endpoints that feed it are gated to leads on the backend.
 *
 * Everyone else (regular SEs, admins) gets the own-team view (see
 * `OwnTeamView`): the team's Salesforce CARR roll-up + per-AE breakdown and
 * the viewer's personal Linear tickets, scoped to their own team. The :slug
 * in the URL is cosmetic — a mismatch redirects to the canonical slug.
 */
function TeamPage() {
  const { user } = useAuth();
  const { slug } = useParams();
  const team = user?.team;

  // Only SE leads get the pack overview (everyone's numbers). Everyone else
  // (regular SEs, admins) gets the own-team view (`OwnTeamView`) scoped to
  // their own team. The pack endpoints are gated to leads on the backend, so
  // this is the real security boundary, not just a UX convenience.
  const isLead = useMemo(() => {
    const roles = user?.roles || [];
    return roles.includes('sales_engineer_lead');
  }, [user?.roles]);

  // Scope controls: which calendar year to load, and whether to show the
  // full year (quarter === 0) or a single quarter (1-4).
  const [selectedYear, setSelectedYear] = useState(getCurrentYear());
  const [quarter, setQuarter] = useState(0);

  // Derived once per render and threaded through the memos / labels below.
  const quarterKey = buildQuarterKey(selectedYear, quarter);
  const periodLabel = buildPeriodLabel(selectedYear, quarter);

  // Pack payload (per-SE roll-up) and error state.
  const [packData, setPackData] = useState(null);
  const [packError, setPackError] = useState(null);

  // Per-SE Closed CARR roll-up (Salesforce, attributed via handoff pages).
  const [packCarr, setPackCarr] = useState(null);

  // When set, the chart is replaced by a high-level detail panel for the
  // chosen SE (their workload + closed breakdown). Cleared by the "back"
  // button. All the numbers come from the pack payload already in memory,
  // so drilling in costs no extra request.
  const [selectedSeId, setSelectedSeId] = useState(null);

  // Actual Linear tickets (open + closed-this-year) for the drilled-into
  // SE. Fetched lazily the first time a row is opened; the closed list is
  // filtered down to the active quarter client-side when the quarter pill
  // is on, so we only ever hit the endpoint once per SE.
  const [seTickets, setSeTickets] = useState(null);
  const [seTicketsError, setSeTicketsError] = useState(null);

  // Today's calendar for the drilled-into SE. Fetched lazily per SE; not
  // year-scoped (always "today"), so it only depends on the selection.
  const [seCalendar, setSeCalendar] = useState(null);
  const [seCalendarError, setSeCalendarError] = useState(null);

  useEffect(() => {
    if (!selectedSeId) {
      setSeTickets(null);
      setSeTicketsError(null);
      return undefined;
    }
    let cancelled = false;
    setSeTickets(null);
    setSeTicketsError(null);
    fetchPackSeTickets(selectedSeId, selectedYear)
      .then((payload) => {
        if (!cancelled) setSeTickets(payload);
      })
      .catch((err) => {
        if (!cancelled) setSeTicketsError(err?.message || 'Failed to load tickets');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSeId, selectedYear]);

  // Pull the selected SE's today calendar. Soft state — a failure or an
  // unconnected SE just renders a hint inside the panel.
  useEffect(() => {
    if (!selectedSeId) {
      setSeCalendar(null);
      setSeCalendarError(null);
      return undefined;
    }
    let cancelled = false;
    setSeCalendar(null);
    setSeCalendarError(null);
    fetchPackSeCalendar(selectedSeId)
      .then((payload) => {
        if (!cancelled) setSeCalendar(payload);
      })
      .catch((err) => {
        if (!cancelled) setSeCalendarError(err?.message || 'Failed to load calendar');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSeId]);

  // Fetch the pack-wide roll-up once we know the viewer is a lead, scoped to
  // the selected year. Refetches when the year changes; the quarter pill then
  // slices the returned `byQuarter` buckets client-side. Soft-fails into a hint.
  useEffect(() => {
    if (!isLead) return undefined;
    let cancelled = false;
    setPackError(null);
    fetchPackOverview(selectedYear)
      .then((payload) => {
        if (!cancelled) setPackData(payload);
      })
      .catch((err) => {
        if (!cancelled) setPackError(err?.message || 'Failed to load pack overview');
      });
    return () => {
      cancelled = true;
    };
  }, [isLead, selectedYear]);

  // Pull the per-SE Closed CARR roll-up alongside the pack overview. Soft
  // state only — CARR is a "nice to have" below the chart, so a failure or
  // an unconfigured Salesforce year just hides the section rather than
  // blocking the page.
  useEffect(() => {
    if (!isLead) return undefined;
    let cancelled = false;
    fetchPackCarr(selectedYear)
      .then((payload) => {
        if (!cancelled) setPackCarr(payload);
      })
      .catch(() => {
        if (!cancelled) setPackCarr({ configured: false, sets: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isLead, selectedYear]);

  // One row per SE, scoped to the active pill and sorted by completed
  // tickets descending so the chart reads left-to-right from most to
  // least productive.
  const packRows = useMemo(() => {
    // Drop the viewing lead's own row — they're looking at the pack, not
    // themselves. Match on the app user id the backend stamps onto each set.
    const sets = (packData?.sets || []).filter((s) => s.userId !== user?.id);
    const rows = sets.map((set) => {
      const closed = quarterKey
        ? set.closed?.byQuarter?.[quarterKey] || {}
        : set.closed?.total || {};
      return {
        seId: set.seId,
        name: set.name,
        open: set.open || 0,
        creation: closed.creation || 0,
        scoping: closed.estimation || 0,
        completed: closed.total || 0,
      };
    });
    rows.sort((a, b) => b.completed - a.completed);
    return rows;
  }, [packData, quarterKey, user?.id]);

  // Pack-wide totals across the displayed SEs (already lead-excluded and
  // scoped to the active year/quarter), shown as summary cards above the
  // chart.
  const packTotals = useMemo(
    () =>
      packRows.reduce(
        (acc, r) => ({
          ses: acc.ses + 1,
          open: acc.open + r.open,
          creation: acc.creation + r.creation,
          scoping: acc.scoping + r.scoping,
          completed: acc.completed + r.completed,
        }),
        { ses: 0, open: 0, creation: 0, scoping: 0, completed: 0 },
      ),
    [packRows],
  );

  // Per-SE Closed CARR for the active scope, lead excluded, sorted high to
  // low. `max` drives the proportional bar widths; `total` is the pack sum.
  const carrBreakdown = useMemo(() => {
    const rows = (packCarr?.sets || [])
      .filter((s) => s.userId !== user?.id)
      .map((s) => ({
        seId: s.seId,
        name: s.name,
        carr: quarterKey ? s.byQuarter?.[quarterKey] || 0 : s.total || 0,
      }))
      .sort((a, b) => b.carr - a.carr);
    const max = rows.reduce((m, r) => Math.max(m, r.carr), 0);
    const total = rows.reduce((sum, r) => sum + r.carr, 0);
    return { rows, max, total };
  }, [packCarr, quarterKey, user?.id]);

  // Pre-compute the SVG layout (bar rects, y-axis ticks, x labels) for
  // the grouped bar chart. Bars are grouped by SE; within a group the
  // three series sit side by side with a small gap.
  const chartLayout = useMemo(() => {
    const rows = packRows;
    const plotW = CHART.w - CHART.padLeft - CHART.padRight;
    const plotH = CHART.h - CHART.padTop - CHART.padBottom;
    const baseY = CHART.padTop + plotH;
    const maxVal = rows.reduce((m, r) => Math.max(m, r.creation, r.scoping, r.completed), 0);
    const yMax = niceChartMax(maxVal);
    const yTicks = buildYTicks(yMax);
    const n = rows.length;
    const groupW = n > 0 ? plotW / n : plotW;
    const groupInner = groupW * 0.64;
    const slotW = groupInner / CHART_SERIES.length;
    const barW = slotW * 0.84;

    const groups = rows.map((row, i) => {
      const slotX = CHART.padLeft + i * groupW;
      const x0 = slotX + (groupW - groupInner) / 2;
      const bars = CHART_SERIES.map((s, j) => {
        const val = row[s.key] || 0;
        const h = yMax > 0 ? (val / yMax) * plotH : 0;
        return {
          key: s.key,
          val,
          x: x0 + j * slotW + (slotW - barW) / 2,
          y: baseY - h,
          w: barW,
          h,
        };
      });
      return {
        seId: row.seId,
        name: row.name,
        label: row.name.split(/\s+/)[0],
        cx: slotX + groupW / 2,
        bars,
      };
    });

    return { plotW, plotH, baseY, yMax, yTicks, groups };
  }, [packRows]);

  // High-level detail for the SE the lead clicked into. Pulls the same
  // category breakdown the chart uses (plus AI Demo / Other), scoped by
  // the active pill. Returns null when nothing is selected or the SE
  // fell out of the payload on a refetch.
  const selectedDetail = useMemo(() => {
    if (!selectedSeId) return null;
    const set = (packData?.sets || []).find((s) => s.seId === selectedSeId);
    if (!set) return null;
    const closed = quarterKey ? set.closed?.byQuarter?.[quarterKey] || {} : set.closed?.total || {};
    return {
      seId: set.seId,
      name: set.name,
      open: set.open || 0,
      completed: closed.total || 0,
      creation: closed.creation || 0,
      scoping: closed.estimation || 0,
      aiDemo: closed.aiDemo || 0,
      other: closed.other || 0,
    };
  }, [selectedSeId, packData, quarterKey]);

  // The closed tickets to actually list, narrowed to the current quarter
  // when the quarter pill is active so the list stays in lockstep with
  // the headline "Completed" tile above it. Open workload is always
  // "right now", so it ignores the scope.
  const visibleClosedTickets = useMemo(() => {
    const closed = seTickets?.closed || [];
    if (!quarterKey) return closed;
    return closed.filter((t) => quarterKeyOf(t.completedAt) === quarterKey);
  }, [seTickets, quarterKey]);

  // Split "Team Mario" → { prefix: "Team", rest: "Mario" } so the prefix
  // renders in white and the identity (rest) pops in coral, matching the
  // dashboard hero. Single-word names render the whole thing in coral.
  const teamParts = useMemo(() => {
    const raw = team?.name?.trim();
    if (!raw) return null;
    const idx = raw.indexOf(' ');
    if (idx === -1) return { prefix: '', rest: raw };
    return { prefix: raw.slice(0, idx), rest: raw.slice(idx + 1) };
  }, [team?.name]);

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

  const mascot = TEAM_MASCOTS[canonicalSlug];

  const selectSe = (seId) => setSelectedSeId(seId);

  return (
    <div className="dashboard">
      {/*
        Three-column hero: flexible spacer on the left, big centered
        title in the middle, optional mascot pinned to the right.
      */}
      <header className="page-header team-page__hero">
        <h1 className="team-page__hero-title">
          {teamParts.prefix && <>{teamParts.prefix} </>}
          <span className="page-header__name">{teamParts.rest}</span>
        </h1>
        {mascot && <img className="team-page__mascot" src={mascot.src} alt={mascot.alt} />}
      </header>

      {isLead ? (
        <div className="team-page__body">
          <div className="team-page__controls">
            {selectedDetail && (
              <button
                type="button"
                className="team-pack__back"
                onClick={() => setSelectedSeId(null)}
              >
                <LuArrowLeft aria-hidden="true" />
                Back to the pack
              </button>
            )}
            <div className="team-page__scope">
              <select
                className="team-page__year"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                aria-label="Year"
              >
                {AVAILABLE_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <div
                className="team-page__filter"
                role="tablist"
                aria-label="Scope metrics by full year or quarter"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={quarter === 0}
                  className={`team-page__filter-btn ${quarter === 0 ? 'is-active' : ''}`}
                  onClick={() => setQuarter(0)}
                >
                  Full Year
                </button>
                {[1, 2, 3, 4].map((q) => (
                  <button
                    key={q}
                    type="button"
                    role="tab"
                    aria-selected={quarter === q}
                    className={`team-page__filter-btn ${quarter === q ? 'is-active' : ''}`}
                    onClick={() => setQuarter(q)}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <section className="team-page__section">
            <div className="team-page__section-header">
              <div className="team-page__section-heading">
                {selectedDetail ? (
                  <>
                    <h2 className="team-page__section-title">{selectedDetail.name}</h2>
                    <p className="team-page__section-subtitle">
                      Open workload and tickets completed in {periodLabel}.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="team-page__section-title">The Pack</h2>
                    <p className="team-page__section-subtitle">
                      Creation, scoping, and completed tickets per SE in {periodLabel}. Click an SE
                      for their workload and full breakdown.
                    </p>
                  </>
                )}
              </div>
            </div>

            {packError ? (
              <p className="team-page__linear-hint">
                Couldn&apos;t load the pack overview right now. Try refreshing in a minute.
              </p>
            ) : !packData ? (
              <p className="team-page__linear-hint">Loading the pack…</p>
            ) : selectedDetail ? (
              <>
                <div className="team-page__totals" style={{ '--tile-cols': 5 }}>
                  {[
                    {
                      label: 'Workload',
                      value: selectedDetail.open,
                      hint: 'open right now',
                      Icon: LuInbox,
                    },
                    { label: 'Completed', value: selectedDetail.completed, Icon: LuCircleCheck },
                    { label: 'Creation', value: selectedDetail.creation, Icon: LuFilePlus },
                    { label: 'Scoping', value: selectedDetail.scoping, Icon: LuRuler },
                    { label: 'AI Demo', value: selectedDetail.aiDemo, Icon: LuSparkles },
                  ].map((tile) => (
                    <article key={tile.label} className="team-pack-detail__tile">
                      <div className="team-pack-detail__head">
                        <span className="team-pack-detail__label">{tile.label}</span>
                        <span className="team-pack-detail__icon" aria-hidden="true">
                          <tile.Icon />
                        </span>
                      </div>
                      <span className="team-pack-detail__value">
                        {tile.value.toLocaleString('en-US')}
                      </span>
                      {tile.hint && <span className="team-pack-detail__hint">{tile.hint}</span>}
                    </article>
                  ))}
                </div>

                <section className="team-cal">
                  <h3 className="team-cal__heading">Today&apos;s calendar</h3>
                  <SeCalendar payload={seCalendar} error={seCalendarError} />
                </section>

                <TicketLists
                  error={seTicketsError}
                  loaded={Boolean(seTickets)}
                  open={seTickets?.open || []}
                  closed={visibleClosedTickets}
                  periodLabel={periodLabel}
                />
              </>
            ) : packRows.length === 0 ? (
              <p className="team-page__linear-hint">No Sales Engineers in the pack yet.</p>
            ) : (
              <>
                <div className="team-page__totals team-pack-totals" style={{ '--tile-cols': 4 }}>
                  {[
                    {
                      label: 'Workload',
                      value: packTotals.open,
                      hint: 'open across the pack',
                      Icon: LuInbox,
                    },
                    { label: 'Creation', value: packTotals.creation, Icon: LuFilePlus },
                    { label: 'Scoping', value: packTotals.scoping, Icon: LuRuler },
                    { label: 'Completed', value: packTotals.completed, Icon: LuCircleCheck },
                  ].map((tile) => (
                    <article key={tile.label} className="team-pack-detail__tile">
                      <div className="team-pack-detail__head">
                        <span className="team-pack-detail__label">{tile.label}</span>
                        <span className="team-pack-detail__icon" aria-hidden="true">
                          <tile.Icon />
                        </span>
                      </div>
                      <span className="team-pack-detail__value">
                        {tile.value.toLocaleString('en-US')}
                      </span>
                      {tile.hint && <span className="team-pack-detail__hint">{tile.hint}</span>}
                    </article>
                  ))}
                </div>

                <section
                  className="dashboard-panel team-pack-chart"
                  aria-label="Pack overview by SE"
                >
                  <svg
                    className="team-pack-chart__svg"
                    viewBox={`0 0 ${CHART.w} ${CHART.h}`}
                    role="img"
                    aria-label="Creation, scoping, and completed tickets per Sales Engineer"
                  >
                    {chartLayout.yTicks.map((t) => {
                      const y = chartLayout.baseY - (t / chartLayout.yMax) * chartLayout.plotH;
                      return (
                        <g key={t}>
                          <line
                            className="team-pack-chart__grid"
                            x1={CHART.padLeft}
                            y1={y}
                            x2={CHART.w - CHART.padRight}
                            y2={y}
                          />
                          <text
                            className="team-pack-chart__ytick"
                            x={CHART.padLeft - 8}
                            y={y}
                            textAnchor="end"
                            dominantBaseline="middle"
                          >
                            {t}
                          </text>
                        </g>
                      );
                    })}

                    {chartLayout.groups.map((g) => (
                      <g
                        key={g.seId}
                        className="team-pack-chart__group"
                        role="button"
                        tabIndex={0}
                        aria-label={`View ${g.name}'s details`}
                        onClick={() => selectSe(g.seId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectSe(g.seId);
                          }
                        }}
                      >
                        {/* Transparent hit area spanning the full plot height so
                            the whole column is clickable, not just the bars. */}
                        <rect
                          className="team-pack-chart__hit"
                          x={g.cx - chartLayout.plotW / chartLayout.groups.length / 2}
                          y={CHART.padTop}
                          width={chartLayout.plotW / chartLayout.groups.length}
                          height={chartLayout.plotH}
                        />
                        {g.bars.map((b) => (
                          <g key={b.key} className="team-pack-chart__bar-cell">
                            <rect
                              className={`team-pack-chart__bar team-pack-chart__bar--${b.key}`}
                              x={b.x}
                              y={b.y}
                              width={b.w}
                              height={b.h}
                              rx="2"
                            />
                            <text
                              className="team-pack-chart__bar-value"
                              x={b.x + b.w / 2}
                              y={b.y - 6}
                              textAnchor="middle"
                            >
                              {b.val}
                            </text>
                          </g>
                        ))}
                        <text
                          className="team-pack-chart__xlabel"
                          x={g.cx}
                          y={CHART.h - CHART.padBottom + 20}
                          textAnchor="middle"
                        >
                          {g.label}
                        </text>
                      </g>
                    ))}
                  </svg>

                  <div className="team-pack-chart__legend">
                    {CHART_SERIES.map((s) => (
                      <span
                        key={s.key}
                        className={`team-pack-chart__legend-item team-pack-chart__legend-item--${s.key}`}
                      >
                        <span className="team-pack-chart__legend-swatch" aria-hidden="true" />
                        {s.label}
                      </span>
                    ))}
                  </div>
                </section>

                {packCarr && packCarr.configured && carrBreakdown.total > 0 && (
                  <section className="dashboard-panel team-carr" aria-label="Closed CARR by SE">
                    <div className="team-carr__header">
                      <h3 className="team-carr__title">Closed CARR by SE</h3>
                      <span className="team-carr__total">
                        {formatCompactUSD(carrBreakdown.total)}
                      </span>
                    </div>
                    <ul className="team-carr__list">
                      {carrBreakdown.rows.map((row) => (
                        <li key={row.seId} className="team-carr__row">
                          <span className="team-carr__name" title={row.name}>
                            {row.name}
                          </span>
                          <span className="team-carr__track">
                            <span
                              className="team-carr__bar"
                              style={{
                                width: `${
                                  carrBreakdown.max > 0 ? (row.carr / carrBreakdown.max) * 100 : 0
                                }%`,
                              }}
                            />
                          </span>
                          <span className="team-carr__amount">{formatCompactUSD(row.carr)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="team-carr__note">
                      Closed in {periodLabel}, attributed by each closed-won deal&apos;s AE and the
                      team they belong to.
                    </p>
                  </section>
                )}
              </>
            )}
          </section>
        </div>
      ) : (
        <OwnTeamView team={team} user={user} />
      )}
    </div>
  );
}

export default TeamPage;
