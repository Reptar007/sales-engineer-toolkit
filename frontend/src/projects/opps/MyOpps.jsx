import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listMyOpps, createOpp } from '../../services/api';
import CreateOppModal from './components/CreateOppModal';
import './opps.less';

/**
 * Per-SE landing page for the Opps area. Two stacks:
 *
 *   1. From Linear: Opportunity Names auto-grouped from the SE's open
 *      AE Request tickets. Clicking a card upserts the matching DB row
 *      (creating it on first click) and routes to the detail page so a
 *      handoff page exists by the time the SE wants to write notes.
 *
 *   2. Saved: Opps already in the DB owned by this user. Each row links
 *      straight to the detail page.
 */
function MyOpps() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creatingName, setCreatingName] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMyOpps();
      setPayload(res);
    } catch (err) {
      setError(err.message || 'Failed to load your opps');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Linear-derived cards don't have a DB id until the SE clicks one. We
  // upsert here so the detail page can render immediately and so the
  // opp shows up in the team directory.
  const openLinearOpp = async (oppName) => {
    setCreatingName(oppName);
    try {
      const res = await createOpp({ oppName });
      navigate(`/projects/opps/${res.opp.id}`);
    } catch (err) {
      setError(err.message || 'Failed to open Opp');
    } finally {
      setCreatingName(null);
    }
  };

  return (
    <div className="opps-page">
      <div className="opps-page__header">
        <div className="opps-page__title-block">
          <div className="opps-page__overline">YOUR PROWL</div>
          <h1>My Hunts</h1>
          <p>
            Your active Linear tickets grouped by opportunity, plus every handoff
            page you&apos;ve saved.
          </p>
        </div>
        <div className="opps-page__actions">
          <Link to="/projects/opps" className="opps-page__btn">
            Hunt Board
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

      {error && <div className="opps-error">{error}</div>}
      {loading && <p className="opp-section__placeholder">Loading…</p>}

      {!loading && payload && (
        <div className="my-opps__columns">
          <section className="my-opps__column">
            <h2>From Linear</h2>
            <p className="my-opps__column-sub">
              Grouped from open AE Request tickets where you&apos;re assigned.
            </p>
            {!payload.linear.configured && payload.linear.needsLinearProfile && (
              <p className="opp-section__placeholder">
                Connect your Linear profile from <Link to="/profile">My Wolf</Link> to see
                tickets grouped by opportunity here.
              </p>
            )}
            {payload.linear.configured && payload.linear.groups.length === 0 && (
              <p className="opp-section__placeholder">
                No open AE Request tickets with an Opportunity Name field yet.
              </p>
            )}
            {payload.linear.groups.map((group) => (
              <div
                key={group.oppName}
                className="my-opps__card"
                role="button"
                tabIndex={0}
                onClick={() => openLinearOpp(group.oppName)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openLinearOpp(group.oppName);
                }}
              >
                <div className="my-opps__card__name">{group.oppName}</div>
                <div className="my-opps__card__meta">
                  {group.tickets.length} ticket{group.tickets.length === 1 ? '' : 's'}
                  {creatingName === group.oppName ? ' · opening…' : ''}
                </div>
              </div>
            ))}
          </section>

          <section className="my-opps__column">
            <h2>Saved</h2>
            <p className="my-opps__column-sub">
              Hunts you&apos;ve created or already saved notes on.
            </p>
            {payload.saved.length === 0 && (
              <p className="opp-section__placeholder">No saved hunts yet.</p>
            )}
            {payload.saved.map((opp) => (
              <Link
                key={opp.id}
                to={`/projects/opps/${opp.id}`}
                className="my-opps__card"
              >
                <div className="my-opps__card__name">{opp.oppName}</div>
                <div className="my-opps__card__meta">
                  Updated {new Date(opp.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </section>
        </div>
      )}

      {showCreate && (
        <CreateOppModal
          onClose={() => setShowCreate(false)}
          onCreated={(opp) => navigate(`/projects/opps/${opp.id}`)}
        />
      )}
    </div>
  );
}

export default MyOpps;
