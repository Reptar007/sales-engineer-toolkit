import React, { useEffect, useMemo, useState } from 'react';
import { listMyLinearTickets, linkLinearTicket } from '../../../services/api';

/**
 * Modal picker for manually linking a Linear ticket to an Opp.
 *
 * Shows the caller's currently-open Linear tickets so the SE can click
 * the one they want to link rather than copy-pasting an identifier. The
 * already-linked rawIds (auto-discovered + previously manual) are passed
 * in via `excludeRawIds` so we hide tickets that would otherwise be
 * idempotent no-ops.
 *
 * Pasting a Linear URL / identifier in the search box AND no list match
 * also still works -- the "Link by identifier" button at the bottom
 * sends the raw input through the same POST endpoint, so the modal
 * covers the "ticket is assigned to someone else" edge case too.
 */
function LinkLinearTicketModal({ oppId, excludeRawIds = [], onClose, onLinked }) {
  const [state, setState] = useState({ loading: true, configured: false, tickets: [] });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listMyLinearTickets();
        if (cancelled) return;
        setState({
          loading: false,
          configured: !!res.configured,
          tickets: Array.isArray(res.tickets) ? res.tickets : [],
          needsLinearProfile: !!res.needsLinearProfile,
          reason: res.reason || null,
        });
      } catch (err) {
        if (!cancelled) {
          setState({ loading: false, configured: false, tickets: [] });
          setError(err.message || 'Failed to load Linear tickets');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter out already-linked tickets up front so the SE never sees
  // a row that would 409 on click.
  const excludedSet = useMemo(
    () => new Set((excludeRawIds || []).filter(Boolean)),
    [excludeRawIds],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return state.tickets
      .filter((t) => !excludedSet.has(t.rawId))
      .filter((t) => {
        if (!needle) return true;
        return (
          (t.id || '').toLowerCase().includes(needle) ||
          (t.title || '').toLowerCase().includes(needle) ||
          (t.project || '').toLowerCase().includes(needle)
        );
      });
  }, [state.tickets, search, excludedSet]);

  const link = async (identifier) => {
    setBusy(true);
    setError(null);
    try {
      await linkLinearTicket(oppId, identifier);
      await onLinked();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to link ticket');
      setBusy(false);
    }
  };

  // Close on Esc -- standard modal affordance.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div
      className="opp-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="opp-modal opp-link-modal" role="dialog" aria-modal="true">
        <h3 className="opp-modal__title">Link a Linear ticket</h3>
        <p className="opp-modal__sub">
          Pick from your open Linear tickets, or paste a different ticket&apos;s
          identifier (e.g. <code>AXO-959</code>) if the AE assigned it to
          someone else.
        </p>

        <div className="opp-modal__row">
          <input
            className="opp-link-modal__search"
            placeholder="Search by title, ID, or project…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            disabled={busy}
          />
        </div>

        {state.loading && (
          <p className="opp-section__placeholder">Loading your tickets…</p>
        )}

        {!state.loading && !state.configured && (
          <p className="opp-section__placeholder">
            Linear isn&apos;t configured on the server. Paste an identifier below
            to attempt a direct link anyway.
          </p>
        )}

        {!state.loading && state.configured && state.needsLinearProfile && (
          <p className="opp-section__placeholder">
            Your Linear account isn&apos;t linked to your app profile yet. Open
            the Dashboard once to set it up, or paste a ticket identifier
            below.
          </p>
        )}

        {!state.loading && state.configured && !state.needsLinearProfile && (
          <div className="opp-link-modal__list">
            {filtered.length === 0 ? (
              <p className="opp-section__placeholder">
                {state.tickets.length === 0
                  ? 'No open tickets assigned to you right now.'
                  : 'No tickets match your search.'}
              </p>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.rawId || t.id}
                  type="button"
                  className="opp-link-modal__item"
                  onClick={() => link(t.id)}
                  disabled={busy}
                >
                  <span className="opp-link-modal__item-id">{t.id}</span>
                  <span className="opp-link-modal__item-title" title={t.title}>
                    {t.title}
                  </span>
                  <span className="opp-link-modal__item-meta">
                    {t.project && <span>{t.project}</span>}
                    {t.state && (
                      <>
                        {t.project && <span aria-hidden> · </span>}
                        <span>{t.state}</span>
                      </>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/*
          Fallback: link by raw identifier. Useful when the ticket is
          assigned to a different SE or when Linear is unreachable for
          the picker fetch -- we still try the link POST and surface
          its error if it fails.
        */}
        {search.trim() && (
          <div className="opp-link-modal__paste-fallback">
            <span>Can&apos;t find it?</span>
            <button
              type="button"
              className="opps-page__btn opps-page__btn--primary"
              disabled={busy}
              onClick={() => link(search.trim())}
            >
              Link &ldquo;{search.trim()}&rdquo;
            </button>
          </div>
        )}

        {error && <p className="opp-modal__error">{error}</p>}

        <div className="opp-modal__actions">
          <button
            type="button"
            className="opps-page__btn"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default LinkLinearTicketModal;
