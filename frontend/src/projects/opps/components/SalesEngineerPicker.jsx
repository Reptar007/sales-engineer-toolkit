import React, { useEffect, useState } from 'react';
import { listSalesEngineersForOpps } from '../../../services/api';

/**
 * SE field for the Hunt Board handoff page. Renders as a single
 * `.opp-property` block labeled "SE" -- a plain read-only value for
 * regular SEs, or a select for admins / Leads who can reassign.
 *
 * The privilege check is implicit: the list endpoint 403s for
 * non-privileged callers, so we render read-only on 403 and the select
 * on any successful list response. This collapses what used to be two
 * separate UI elements (read-only SE + reassign dropdown) into one.
 *
 * Props:
 *   currentSeId: the Opp's current `salesEngineer.id`.
 *   currentSeName: display name to show in the read-only / fallback state.
 *   onChange(seId): called when an admin picks a different SE.
 */
function SalesEngineerPicker({ currentSeId, currentSeName, onChange }) {
  const [ses, setSes] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listSalesEngineersForOpps();
        if (!cancelled) setSes(res.salesEngineers || []);
      } catch (err) {
        // 403 = caller isn't admin/Lead -- render the read-only fallback.
        if (/403/.test(err?.message)) {
          if (!cancelled) setSes([]);
        } else if (!cancelled) {
          setError(err.message || 'Failed to load SEs');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Still loading the SE roster. Render the read-only name so the field
  // isn't visually empty during the round-trip.
  if (ses === null || ses.length === 0) {
    return (
      <div className="opp-property">
        <span className="opp-property__label">SE</span>
        <span className="opp-property__value">{currentSeName || 'Unowned'}</span>
      </div>
    );
  }

  const handle = async (e) => {
    const nextId = e.target.value;
    if (!nextId || nextId === currentSeId) return;
    setSaving(true);
    setError(null);
    try {
      await onChange(nextId);
    } catch (err) {
      setError(err.message || 'Reassignment failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="opp-property">
      <span className="opp-property__label">SE</span>
      <select
        className="opp-property__input"
        value={currentSeId || ''}
        onChange={handle}
        disabled={saving}
      >
        {ses.map((se) => {
          const name = [se.firstName, se.lastName].filter(Boolean).join(' ') || se.email || se.id;
          return (
            <option key={se.id} value={se.id}>
              {name}
            </option>
          );
        })}
      </select>
      {error && (
        <span className="opp-detail__save-status" style={{ color: '#fda4af' }}>
          {error}
        </span>
      )}
    </div>
  );
}

export default SalesEngineerPicker;
