import React, { useMemo, useState } from 'react';
import { unlinkLinearTicket } from '../../../services/api';
import LinkLinearTicketModal from './LinkLinearTicketModal';

/**
 * Card showing every Linear ticket that references this Opp's name,
 * grouped by category (Creation / Scope / AI Demo / Other). The backend
 * service has already classified and sorted within each bucket so we
 * just need to render. Open tickets sit above closed; we dim closed
 * rows slightly to keep the active work visually prominent.
 *
 * Editors get a "+ Link a ticket" button that opens a modal listing
 * their currently-open Linear tickets so they can click to link --
 * used when the AE didn't follow naming conventions and the auto-
 * discovery query misses the ticket. Manually linked tickets show
 * with a "Manual" pill and an unlink (x) affordance.
 */
const CATEGORIES = [
  { key: 'creation', label: 'Test Creation' },
  { key: 'scope', label: 'Scope / Estimation' },
  { key: 'aiDemo', label: 'AI Demo / Workshop' },
  { key: 'other', label: 'Other Tickets' },
];

function TicketRow({ ticket, oppId, canEdit, onChanged }) {
  const [removing, setRemoving] = useState(false);
  const inner = (
    <>
      <span className="opp-ticket__id">{ticket.id}</span>
      <span className="opp-ticket__title" title={ticket.title}>
        {ticket.title}
      </span>
      {ticket.slackThread && (
        // Inline Slack pill -- click jumps directly to the AE's Slack
        // request thread for this Linear ticket. Stop propagation so the
        // outer ticket link doesn't also fire and open Linear in a new
        // tab on top of Slack.
        <a
          className="opp-ticket__slack"
          href={ticket.slackThread}
          target="_blank"
          rel="noopener noreferrer"
          title="Open Slack thread"
          onClick={(e) => e.stopPropagation()}
        >
          Slack
        </a>
      )}
      {ticket.manual && (
        <span className="opp-ticket__manual-pill" title="Manually linked">
          Manual
        </span>
      )}
      {ticket.state && <span className="opp-ticket__state">{ticket.state}</span>}
      {canEdit && ticket.manual && (
        <button
          type="button"
          className="opp-ticket__unlink"
          title="Remove manual link"
          aria-label={`Unlink ${ticket.id}`}
          disabled={removing}
          // Stop the click from bubbling to the parent <a>, which would
          // otherwise navigate to Linear instead of unlinking.
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setRemoving(true);
            try {
              await unlinkLinearTicket(oppId, ticket.id);
              await onChanged();
            } catch {
              setRemoving(false);
            }
          }}
        >
          ×
        </button>
      )}
    </>
  );
  const className = `opp-ticket${ticket.isClosed ? ' opp-ticket--closed' : ''}${ticket.manual ? ' opp-ticket--manual' : ''}`;
  if (ticket.url) {
    return (
      <a
        className={className}
        href={ticket.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}

function LinearTicketsCard({ linearTickets, oppId, canEdit, onChanged }) {
  const [picking, setPicking] = useState(false);

  // Collect already-linked rawIds across all buckets so the picker can
  // hide them. Memoized so the modal doesn't re-filter on every keystroke.
  const linkedRawIds = useMemo(() => {
    if (!linearTickets) return [];
    const ids = [];
    for (const cat of ['creation', 'scope', 'aiDemo', 'other']) {
      for (const t of linearTickets[cat] || []) {
        if (t.rawId) ids.push(t.rawId);
      }
    }
    return ids;
  }, [linearTickets]);

  if (!linearTickets) return null;

  const linkButton = canEdit && linearTickets.configured && (
    <button
      type="button"
      className="opps-page__btn opp-linked-link-btn"
      onClick={() => setPicking(true)}
    >
      + Link a ticket
    </button>
  );

  const header = (
    <div className="opp-section__head">
      <h3 className="opp-section__title">
        Linked Linear tickets
        {linearTickets.total > 0 && (
          <span style={{ opacity: 0.5, fontWeight: 500, marginLeft: '0.4rem' }}>
            ({linearTickets.total})
          </span>
        )}
      </h3>
      {linkButton}
    </div>
  );

  const modal = picking && (
    <LinkLinearTicketModal
      oppId={oppId}
      excludeRawIds={linkedRawIds}
      onClose={() => setPicking(false)}
      onLinked={onChanged}
    />
  );

  if (!linearTickets.configured) {
    return (
      <div className="opp-section">
        {header}
        <p className="opp-section__placeholder">
          Linear isn&apos;t configured for this app yet.
        </p>
        {modal}
      </div>
    );
  }

  if (!linearTickets.total) {
    return (
      <div className="opp-section">
        {header}
        <p className="opp-section__placeholder">
          No Linear tickets reference this opportunity name yet.
          {canEdit && (
            <>
              {' '}
              <button
                type="button"
                className="opp-linked-inline-link"
                onClick={() => setPicking(true)}
              >
                Link one manually
              </button>{' '}
              if the AE skipped naming.
            </>
          )}
        </p>
        {modal}
      </div>
    );
  }

  return (
    <div className="opp-section">
      {header}
      {(linearTickets.unresolved || []).length > 0 && (
        <p className="opp-linked-unresolved">
          {linearTickets.unresolved.length === 1
            ? `Couldn't resolve ${linearTickets.unresolved[0]} in Linear. `
            : `Couldn't resolve ${linearTickets.unresolved.length} manually-linked tickets. `}
          They may have been deleted or moved out of the configured team.
        </p>
      )}
      {CATEGORIES.map(({ key, label }) => {
        const items = linearTickets[key] || [];
        if (!items.length) return null;
        return (
          <div key={key} className="opp-linked-bucket">
            <div className="opp-linked-bucket__head">
              <span className="opp-linked-bucket__title">{label}</span>
              <span className="opp-linked-bucket__count">{items.length}</span>
            </div>
            {items.map((ticket) => (
              <TicketRow
                key={ticket.rawId || ticket.id}
                ticket={ticket}
                oppId={oppId}
                canEdit={canEdit}
                onChanged={onChanged}
              />
            ))}
          </div>
        );
      })}
      {modal}
    </div>
  );
}

export default LinearTicketsCard;
