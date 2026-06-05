import React, { useState, useEffect, useRef } from 'react';
import { searchOpportunities, createOpp } from '../../../services/api';
import '../opps.less';

/**
 * Modal for creating a new Opp. SEs typed flow:
 *   1. Type 2+ chars -> debounce -> search Salesforce
 *   2. Pick a result -> we send `{ oppName, salesforceOpportunityId }`
 *      to POST /opps and navigate to the new (or upserted) Opp.
 *   3. Or click "Create without SF" to skip the lookup and just save a
 *      manual oppName.
 *
 * onCreated(opp) is invoked with the API response so the parent can
 * navigate to the new detail page.
 */
function CreateOppModal({ onClose, onCreated, initialName = '' }) {
  const [search, setSearch] = useState(initialName);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = search.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const res = await searchOpportunities(trimmed);
        if (res.success) setResults(res.data || []);
        else setResults([]);
      } catch (err) {
        setError(err.message || 'Search failed');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [search]);

  const submit = async ({ oppName, salesforceOpportunityId }) => {
    if (!oppName?.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createOpp({
        oppName: oppName.trim(),
        salesforceOpportunityId: salesforceOpportunityId || null,
      });
      onCreated?.(res.opp);
    } catch (err) {
      setError(err.message || 'Failed to create Opp');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="opp-modal-backdrop" onClick={onClose}>
      <div className="opp-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="opp-modal__title">Start a New Hunt</h2>
        <p className="opp-modal__sub">
          Search Salesforce to link this hunt to an opportunity, or create a manual one without an
          SF match.
        </p>

        <div className="opp-modal__row">
          <input
            autoFocus
            type="text"
            placeholder="Opportunity name or account name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {searching && <p className="opp-section__placeholder">Searching Salesforce…</p>}
        {error && <div className="opps-error">{error}</div>}

        {results.length > 0 && (
          <div className="opp-modal__results">
            {results.map((opp) => (
              <div
                key={opp.id}
                className="opp-modal__result"
                onClick={() => submit({ oppName: opp.name, salesforceOpportunityId: opp.id })}
              >
                <div className="opp-modal__result-name">{opp.name || '(unnamed)'}</div>
                <div className="opp-modal__result-meta">
                  {opp.accountName || 'Unknown account'} · {opp.stage || 'No stage'}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="opp-modal__actions">
          <button type="button" className="opps-page__btn" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button
            type="button"
            className="opps-page__btn opps-page__btn--primary"
            disabled={!search.trim() || creating}
            onClick={() => submit({ oppName: search })}
          >
            {creating ? 'Creating…' : `Create without SF match`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateOppModal;
