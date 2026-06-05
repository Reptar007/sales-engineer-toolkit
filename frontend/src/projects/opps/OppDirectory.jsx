import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listOpps, deleteOpp } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import CreateOppModal from './components/CreateOppModal';
import './opps.less';

/**
 * Team-wide directory of every Opp. Anyone authenticated can view; only
 * the owning SE / Leads / admins can edit the underlying detail page.
 *
 * Columns: Opp name, owning SE, created date, last updated. Free-text
 * search filters by opp name (server-side `?search=`) plus a client-side
 * "mine only" toggle.
 */
function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}

function fullName(se) {
  if (!se) return 'Unowned';
  const parts = [se.firstName, se.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : se.email || 'Unknown SE';
}

// Map QAW's SF pipeline stages to a cool->warm color progression so the
// pill conveys deal heat at a glance. Matcher is keyword-based on the
// lowercased stage (strips the "1. " / "2. " ordering prefix) so renames
// or one-off variants still land on the right bucket. Closed Won/Lost
// are absolute; everything else falls back to a neutral gray.
function stageVariant(stage) {
  if (!stage) return 'unknown';
  const s = String(stage).toLowerCase().replace(/^\d+\.\s*/, '').trim();
  if (s.includes('closed won') || s === 'won') return 'won';
  if (s.includes('closed lost') || s === 'lost') return 'lost';
  if (s.includes('contract')) return 'contracting';
  if (s.includes('proposal') || s.includes('quote')) return 'proposal';
  if (s.includes('evaluat') || s.includes('pilot') || s.includes('demo')) return 'evaluation';
  if (s.includes('qualif') || s.includes('discovery') || s.includes('prospect')) return 'qualify';
  return 'neutral';
}

// SF returns stages prefixed with their order ("1. Qualify"). The number
// is redundant once we're showing a colored pill, so strip it for the
// pill label while keeping the original value in `title` for power users.
function prettyStage(stage) {
  if (!stage) return '';
  return String(stage).replace(/^\d+\.\s*/, '').trim();
}

function StagePill({ stage }) {
  if (!stage) return <span className="opp-stage-pill opp-stage-pill--unknown">—</span>;
  return (
    <span
      className={`opp-stage-pill opp-stage-pill--${stageVariant(stage)}`}
      title={stage}
    >
      {prettyStage(stage)}
    </span>
  );
}

function OppDirectory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [opps, setOpps] = useState([]);
  const [search, setSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await listOpps({ search: search.trim() || undefined });
        if (!cancelled) setOpps(res.opps || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load opps');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    // Debounce search by 250ms so we don't fire a request per keystroke.
    const t = setTimeout(load, search ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  const filtered = useMemo(() => {
    if (!mineOnly) return opps;
    return opps.filter((o) => o.salesEngineer?.userId === user?.id);
  }, [opps, mineOnly, user?.id]);

  const isAdmin = (user?.roles || []).includes('admin');

  // Whether the current user may delete a given row. Admins can delete
  // anything; SEs only their own hunts. Leads (edit-on-behalf) don't get
  // the button -- mirrors the gating on the detail page. The backend
  // re-checks regardless.
  const canDeleteOpp = (opp) =>
    isAdmin || !!(user?.id && opp.salesEngineer?.userId === user.id);

  const handleDelete = async (opp, e) => {
    // Stop the row's navigate-on-click from firing.
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete "${opp.oppName}"? This permanently removes the Hunt Board page and all SE-authored notes. The Notion page (if any) stays in Notion.`,
    );
    if (!confirmed) return;
    // Optimistically drop the row, restore it if the request fails.
    const prev = opps;
    setOpps((list) => list.filter((o) => o.id !== opp.id));
    try {
      await deleteOpp(opp.id);
    } catch (err) {
      setOpps(prev);
      window.alert(err?.message || 'Failed to delete Opp');
    }
  };

  return (
    <div className="opps-page">
      <div className="opps-page__header">
        <div className="opps-page__title-block">
          <div className="opps-page__overline">PACK INTEL</div>
          <h1>Hunt Board</h1>
          <p>Every Opp the pack is tracking. Click any row to open the full handoff page.</p>
        </div>
        <div className="opps-page__actions">
          <Link to="/projects/opps/mine" className="opps-page__btn">
            My Hunts
          </Link>
          <button
            type="button"
            className="opps-page__btn opps-page__btn--primary"
            onClick={() => setShowCreate(true)}
          >
            + New Hunt
          </button>
        </div>
      </div>

      <div className="opps-controls">
        <div className="opps-search">
          <input
            type="text"
            placeholder="Search by Opp name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="opps-filter-toggle">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Mine only
        </label>
      </div>

      {error && <div className="opps-error">{error}</div>}

      <div className="opps-table-wrap">
        <table className="opps-table">
          <thead>
            <tr>
              <th>Opp Name</th>
              <th>SE</th>
              <th>Current Stage</th>
              <th>Created</th>
              <th>Last Updated</th>
              <th className="opps-table__actions-th" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>
                  <div className="opps-empty">Loading…</div>
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="opps-empty">
                    <h3>The board is empty</h3>
                    <p>
                      Start a new hunt with the button above, or jump to{' '}
                      <Link to="/projects/opps/mine">My Hunts</Link> to pick up an
                      active Linear ticket.
                    </p>
                  </div>
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((opp) => (
                <tr key={opp.id} onClick={() => navigate(`/projects/opps/${opp.id}`)}>
                  <td className="opps-table__name">{opp.oppName}</td>
                  <td className="opps-table__owner">{fullName(opp.salesEngineer)}</td>
                  <td className="opps-table__stage">
                    <StagePill stage={opp.currentStage} />
                  </td>
                  <td className="opps-table__date">{formatDate(opp.createdAt)}</td>
                  <td className="opps-table__date">{formatDate(opp.updatedAt)}</td>
                  <td className="opps-table__actions">
                    {canDeleteOpp(opp) && (
                      <button
                        type="button"
                        className="opps-table__delete"
                        title={`Delete ${opp.oppName}`}
                        aria-label={`Delete ${opp.oppName}`}
                        onClick={(e) => handleDelete(opp, e)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateOppModal
          onClose={() => setShowCreate(false)}
          onCreated={(opp) => navigate(`/projects/opps/${opp.id}`)}
        />
      )}
    </div>
  );
}

export default OppDirectory;
