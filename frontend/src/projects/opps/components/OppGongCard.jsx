import React, { useEffect, useState } from 'react';
import { fetchGongConversations } from '../../../services/api';
import { formatDateTime, formatGongDuration } from '../../salesforce/lookup/opportunityHelpers';
import { renderRichText } from '../../salesforce/lookup/richText.jsx';

/**
 * Gong conversations card. Always renders so it can sit in the same grid
 * row as Technical Specs and stretch to the same height. When the SF
 * opportunity has no recordings (or there's no SF link yet), the card
 * shows a placeholder; otherwise the list fills the available height and
 * scrolls internally for opps with many calls.
 */
function OppGongCard({ opportunityId }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  // Map of call id -> bool tracking which summaries are open. We default
  // to collapsed so the list stays scannable; SEs click a row's toggle to
  // expand the Gong-synced brief for that specific call.
  const [expanded, setExpanded] = useState({});

  const toggleSummary = (id) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    if (!opportunityId) {
      setConversations([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetchGongConversations(opportunityId);
        if (!cancelled && res.success) setConversations(res.data || []);
      } catch {
        // Silently degrade -- Gong outage shouldn't break the handoff page.
        if (!cancelled) setConversations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  let body;
  if (!opportunityId) {
    body = (
      <p className="opp-section__placeholder">
        Link a Salesforce opportunity to see Gong calls here.
      </p>
    );
  } else if (loading) {
    body = <p className="opp-section__placeholder">Loading conversations…</p>;
  } else if (conversations.length === 0) {
    body = <p className="opp-section__placeholder">No Gong calls logged yet.</p>;
  } else {
    body = (
      <div className="opp-gong-list">
        {conversations.map((c) => {
          const isOpen = !!expanded[c.id];
          // Only show the toggle when Gong actually synced a brief for
          // this specific call -- many opps have a mix of calls with and
          // without summaries, and an always-on toggle would be misleading.
          const hasSummary =
            typeof c.summary === 'string' && c.summary.trim().length > 0;
          return (
            <div key={c.id} className="opp-gong-item">
              {c.url ? (
                <a
                  className="opp-gong-item__title"
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {c.title || c.name || 'Untitled Conversation'}
                </a>
              ) : (
                <div className="opp-gong-item__title">
                  {c.title || c.name || 'Untitled Conversation'}
                </div>
              )}
              <div className="opp-gong-item__meta">
                {c.duration && <span>{formatGongDuration(c.duration)}</span>}
                {c.duration && c.createdDate && <span aria-hidden> · </span>}
                {c.createdDate && <span>{formatDateTime(c.createdDate)}</span>}
              </div>
              {hasSummary && (
                <>
                  <button
                    type="button"
                    className="opp-gong-item__summary-toggle"
                    onClick={() => toggleSummary(c.id)}
                    aria-expanded={isOpen}
                  >
                    <span
                      className="opp-gong-item__summary-caret"
                      aria-hidden
                    >
                      {isOpen ? '▾' : '▸'}
                    </span>
                    {isOpen ? 'Hide summary' : 'Show summary'}
                  </button>
                  {isOpen && (
                    <div className="opp-gong-item__summary-body">
                      {renderRichText(c.summary)}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const count = conversations.length;

  return (
    // opp-section--flex turns the card into a flex column so the list
    // fills the remaining height and can scroll while the header stays
    // pinned at the top.
    <div className="opp-section opp-section--flex">
      <div className="opp-section__head">
        <h3 className="opp-section__title">
          Gong
          {count > 0 && (
            <span style={{ opacity: 0.5, fontWeight: 500, marginLeft: '0.4rem' }}>
              ({count})
            </span>
          )}
        </h3>
      </div>
      {body}
    </div>
  );
}

export default OppGongCard;
