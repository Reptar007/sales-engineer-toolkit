import React, { useEffect, useState, useCallback } from 'react';
import { fetchGongConversations, analyzeOppGong } from '../../../services/api';

/**
 * "Suggest from calls" review panel. Pulls the opp's Gong call briefs,
 * sends them to Claude (via /opps/:id/analyze-gong), and shows the
 * extracted Integrations / Pain Points / Additional Notes as editable
 * suggestions. Nothing is written to the opp until the SE clicks Append or
 * Replace on a card -- the parent owns the actual persistence via onApply.
 *
 * Props:
 *   oppId             - opp id (for the analyze call)
 *   sfOpportunityId   - SF opp id (to load Gong conversations)
 *   onApply(field, mode, value)
 *       field: 'integrations' | 'painPoints' | 'notes'
 *       mode:  'append' | 'replace'
 *       returns a promise; we surface per-card saved/error state off it
 *   onClose()
 */
const FIELD_META = [
  {
    key: 'integrations',
    field: 'integrations',
    label: 'Integrations',
    hint: 'Third-party tools / systems mentioned across the calls.',
  },
  {
    key: 'painPoints',
    field: 'painPoints',
    label: 'Pain Points',
    hint: 'Problems and risks driving the evaluation.',
  },
  {
    key: 'additionalNotes',
    field: 'notes',
    label: 'Additional Notes',
    hint: 'Rocky sales cycle, stakeholder call-outs, anything a Lead should know.',
  },
];

function GongInsightsModal({ oppId, sfOpportunityId, onApply, onClose }) {
  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [callsAnalyzed, setCallsAnalyzed] = useState(0);
  // Per-card apply state: { [key]: 'saving' | 'saved' | 'error' }
  const [applyState, setApplyState] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      setError(null);
      try {
        let gongConversations = [];
        if (sfOpportunityId) {
          const res = await fetchGongConversations(sfOpportunityId);
          if (res?.success) gongConversations = res.data || [];
        }
        const result = await analyzeOppGong(oppId, { gongConversations });
        if (cancelled) return;
        if (!result?.suggestions) {
          setStatus('empty');
          return;
        }
        setDrafts({
          integrations: result.suggestions.integrations || '',
          painPoints: result.suggestions.painPoints || '',
          additionalNotes: result.suggestions.additionalNotes || '',
        });
        setCallsAnalyzed(result.callsAnalyzed || gongConversations.length);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Failed to analyze calls');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [oppId, sfOpportunityId]);

  const apply = useCallback(
    async (key, field, mode) => {
      const value = (drafts[key] || '').trim();
      if (!value) return;
      setApplyState((s) => ({ ...s, [key]: 'saving' }));
      try {
        await onApply(field, mode, value);
        setApplyState((s) => ({ ...s, [key]: 'saved' }));
        setTimeout(() => {
          setApplyState((s) => {
            const next = { ...s };
            if (next[key] === 'saved') delete next[key];
            return next;
          });
        }, 2500);
      } catch {
        setApplyState((s) => ({ ...s, [key]: 'error' }));
      }
    },
    [drafts, onApply],
  );

  return (
    <div className="opp-modal-backdrop" onClick={onClose}>
      <div
        className="opp-modal opp-modal--insights"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="opp-modal__title">Suggestions from Gong calls</h2>
        <p className="opp-modal__sub">
          Claude read this opp&apos;s Gong call briefs and pulled out what
          might belong in the handoff. Edit anything, then Append or Replace
          into the field.
        </p>

        {status === 'loading' && (
          <div className="opp-insights__loading">
            <span className="opp-insights__spinner" aria-hidden="true" />
            <div className="opp-insights__loading-text">
              <strong>Analyzing call briefs with Claude…</strong>
              <span>Reading the Gong summaries and pulling out the highlights.</span>
            </div>
          </div>
        )}

        {status === 'empty' && (
          <p className="opp-section__placeholder">
            No Gong call briefs are available for this opp yet, so there&apos;s
            nothing to analyze.
          </p>
        )}

        {status === 'error' && <div className="opps-error">{error}</div>}

        {status === 'ready' && (
          <>
            <p className="opp-insights__meta">
              Analyzed {callsAnalyzed} call brief{callsAnalyzed === 1 ? '' : 's'}.
            </p>
            <div className="opp-insights__cards">
              {FIELD_META.map(({ key, field, label, hint }) => {
                const value = drafts[key] || '';
                const cardState = applyState[key];
                const empty = !value.trim();
                return (
                  <div key={key} className="opp-insights__card">
                    <div className="opp-insights__card-head">
                      <span className="opp-property__label">{label}</span>
                      {cardState === 'saving' && (
                        <span className="opp-detail__save-status">Saving…</span>
                      )}
                      {cardState === 'saved' && (
                        <span className="opp-detail__save-status">Added</span>
                      )}
                      {cardState === 'error' && (
                        <span
                          className="opp-detail__save-status"
                          style={{ color: '#fda4af' }}
                        >
                          Failed
                        </span>
                      )}
                    </div>
                    <p className="opp-insights__hint">{hint}</p>
                    {empty ? (
                      <p className="opp-section__placeholder">
                        Nothing found for this in the call briefs.
                      </p>
                    ) : (
                      <>
                        <textarea
                          className="opp-insights__textarea"
                          value={value}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [key]: e.target.value }))
                          }
                          rows={Math.min(10, Math.max(3, value.split('\n').length + 1))}
                        />
                        <div className="opp-insights__actions">
                          <button
                            type="button"
                            className="opps-page__btn"
                            disabled={cardState === 'saving'}
                            onClick={() => apply(key, field, 'append')}
                          >
                            Append
                          </button>
                          <button
                            type="button"
                            className="opps-page__btn"
                            disabled={cardState === 'saving'}
                            onClick={() => apply(key, field, 'replace')}
                          >
                            Replace
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="opp-modal__actions">
          <button type="button" className="opps-page__btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default GongInsightsModal;
