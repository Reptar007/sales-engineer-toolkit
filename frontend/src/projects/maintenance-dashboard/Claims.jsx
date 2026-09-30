import React, { useState } from 'react';
import {
  asSentence,
  claimTag,
  claimTimeLeft,
  formatDate,
  formatDateTime,
  isClaimExpiring,
  listNames,
} from './backlogView';

/**
 * Claims on the Bone Pile: who on the team is on which customer.
 *
 * An SE claims the customer they are working on, with a one-line note if they
 * like, so the others can pick another. Several may claim one customer, each
 * for their own reports. A claim lapses after the server's `claimDays` unless
 * it is renewed. These components only show what useClaims holds and hand
 * each click to the page, which asks the server; nothing here changes a claim
 * on screen before the server has answered.
 */

/** A note as the server stores it: on one line, trimmed. */
function oneLineNote(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const dayCount = (days) => `${days} ${days === 1 ? 'day' : 'days'}`;

/**
 * Who has claimed a customer, as a small tag beside its name, or nothing for
 * nobody. Given `now`, the viewer's own claim says how long it has left once
 * it is close to lapsing, for the claim period `claimDays`; a row redrawn
 * only when its claims change is given none, so it never shows a time gone
 * stale. The hidden words make a row button's accessible name read "…
 * claimed by You".
 */
export function ClaimTag({ claims, now = null, claimDays = null }) {
  const tag = claimTag(claims, { now, claimDays });
  if (!tag) return null;
  return (
    <span
      className={`bone-claim-tag${tag.mine ? ' bone-claim-tag--mine' : ''}${
        tag.expiring ? ' bone-claim-tag--expiring' : ''
      }`}
      title={tag.title}
    >
      <span className="bone-visually-hidden">claimed by </span>
      {tag.text}
    </span>
  );
}

const WAITING_LABELS = { claim: 'Claiming…', renew: 'Renewing…', release: 'Releasing…' };

/**
 * Who is on the customer in focus, and the controls to claim it, renew the
 * viewer's claim or release it. The page gives it a key per customer, so the
 * note being typed belongs to one customer.
 *
 * Until the reader types in it, the note field shows the note saved on the
 * viewer's claim, whatever a poll brings, and renewing leaves that note as it
 * is: a note changed from another tab is never overwritten by what this one
 * showed. Once typed in, the field is the reader's, and a renewal sends it
 * only if it differs from the saved note ('' clears it). A new claim sends a
 * note that is not blank. The field goes back to the saved note once the
 * server has answered.
 *
 * Nothing can be claimed before claims have loaded: the card cannot say who
 * is on the customer yet, and a claim made blind could be the second of two.
 */
export function ClaimCard({
  customer,
  claims,
  loaded,
  error,
  claimDays,
  noteMaxLength,
  busy,
  now,
  onClaim,
  onRelease,
  onRetry,
}) {
  const [draft, setDraft] = useState(null);
  const mine = claims.find((c) => c.mine) || null;
  const others = claims.filter((c) => !c.mine);
  const saved = mine?.note ?? '';
  const shown = draft ?? saved;
  const edited = draft !== null && oneLineNote(draft) !== saved;
  const waiting = busy?.workspaceId === customer.workspaceId ? busy.action : null;
  // One write at a time: every answer replaces the whole list.
  const disabled = !loaded || Boolean(busy);

  let label = claimDays ? `Claim for ${dayCount(claimDays)}` : 'Claim';
  if (waiting) label = WAITING_LABELS[waiting];
  else if (mine) label = edited ? 'Save & renew' : `Renew for ${dayCount(claimDays)}`;
  else if (others.length) label = 'Claim too';

  const submit = async (event) => {
    event.preventDefault();
    if (disabled) return;
    let note;
    if (mine) note = edited ? oneLineNote(draft) : undefined;
    else note = oneLineNote(shown) || undefined;
    const res = await onClaim(customer.workspaceId, note);
    if (res) setDraft(null);
  };

  const releaseMine = async () => {
    const res = await onRelease(customer.workspaceId, mine);
    // The note stays in the field, so claiming again is one click.
    if (res?.released) setDraft((typed) => typed ?? saved);
  };

  const releaseOther = (claim) => {
    const ok = window.confirm(
      `Release ${claim.claimer}'s claim on ${customer.name}? They won't be told.`,
    );
    if (ok) onRelease(customer.workspaceId, claim);
  };

  let list;
  if (!loaded) {
    list = error ? (
      <p className="bone-claim-hint">
        Couldn&apos;t load claims: {asSentence(error)}{' '}
        <button type="button" className="bone-link" onClick={onRetry}>
          Try again
        </button>
      </p>
    ) : (
      <p className="bone-claim-hint">Checking who&apos;s on it…</p>
    );
  } else if (!claims.length) {
    list = <p className="bone-claim-hint">Nobody&apos;s on {customer.name} yet.</p>;
  } else {
    list = (
      <ul className="bone-claim-list">
        {claims.map((claim) => (
          <li key={claim.userId} className={`bone-claim${claim.mine ? ' bone-claim--mine' : ''}`}>
            <span className="bone-claim-who">{claim.mine ? 'You' : claim.claimer}</span>
            <span
              className={`bone-claim-when${
                isClaimExpiring(claim, now, claimDays) ? ' bone-claim-when--expiring' : ''
              }`}
              title={`Expires ${formatDateTime(claim.expiresAt)}`}
            >
              since {formatDate(claim.claimedAt)} · {claimTimeLeft(claim.expiresAt, now)}
            </span>
            {claim.note ? <span className="bone-claim-note">{claim.note}</span> : null}
            {!claim.mine && claim.canRelease ? (
              <button
                type="button"
                className="bone-link"
                onClick={() => releaseOther(claim)}
                disabled={disabled}
                aria-label={`Release ${claim.claimer}'s claim`}
              >
                Release
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="bone-claims">
      <h3>Who&apos;s on {customer.name}</h3>
      {list}
      {loaded && others.length > 0 && !mine ? (
        <p className="bone-claim-hint">
          {listNames(others.map((c) => c.claimer))} {others.length === 1 ? 'is' : 'are'} on it.
          Claim too if you&apos;re taking different reports.
        </p>
      ) : null}
      <form className="bone-claim-form" onSubmit={submit}>
        <input
          type="text"
          className="bone-claim-input"
          maxLength={noteMaxLength}
          placeholder="What are you working on? (optional)"
          aria-label="Note"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
        />
        <button type="submit" className="bone-btn" disabled={disabled}>
          {label}
        </button>
        {mine ? (
          <button
            type="button"
            className="bone-btn bone-btn--ghost"
            onClick={releaseMine}
            disabled={disabled}
            aria-label="Release my claim"
          >
            Release
          </button>
        ) : null}
      </form>
    </div>
  );
}

/**
 * Claims could not be read. Until one read has worked the page shows no
 * claims at all, and says so; after that it keeps the last list, and says
 * how old it is.
 */
export function ClaimsNotice({ loaded, error, checkedAt }) {
  if (!error) return null;
  return (
    <div className="bone-warning">
      {loaded
        ? `Claims couldn't be refreshed: ${asSentence(error)} Showing claims as of ${formatDateTime(checkedAt)}.`
        : `Claims couldn't be loaded: ${asSentence(error)} No claims are shown until they can be.`}
    </div>
  );
}

/**
 * The viewer's claims that need a hand (claimReminders), a line each: one
 * about to lapse, with Renew, which keeps its note; one on a workspace this
 * scan could not read, which shows nowhere else though its backlog may still
 * be there, with Renew and Release; one on a customer no longer in the
 * snapshot, which shows nowhere else either, with Release.
 */
export function ClaimReminders({ reminders, busy, now, onRenew, onRelease, onFocus }) {
  if (!reminders.length) return null;
  const renew = (claim) => (
    <button
      type="button"
      className="bone-link"
      onClick={() => onRenew(claim.workspaceId)}
      disabled={Boolean(busy)}
      aria-label={`Renew my claim on ${claim.workspaceName || 'this customer'}`}
    >
      Renew
    </button>
  );
  const release = (claim) => (
    <button
      type="button"
      className="bone-link"
      onClick={() => onRelease(claim.workspaceId, claim)}
      disabled={Boolean(busy)}
      aria-label={`Release my claim on ${claim.workspaceName || 'this customer'}`}
    >
      Release
    </button>
  );
  return (
    <div className="bone-hint">
      {reminders.map(({ kind, claim, name }) => (
        <div key={claim.workspaceId}>
          {kind === 'expiring' ? (
            <>
              Your claim on{' '}
              <button
                type="button"
                className="bone-customer"
                onClick={() => onFocus(claim.workspaceId)}
              >
                {name}
              </button>{' '}
              has {claimTimeLeft(claim.expiresAt, now)}. {renew(claim)}
            </>
          ) : null}
          {kind === 'unread' ? (
            <>
              {name} couldn&apos;t be read from QA Wolf in this scan, so it isn&apos;t listed; your
              claim on it has {claimTimeLeft(claim.expiresAt, now)}. {renew(claim)} {release(claim)}
            </>
          ) : null}
          {kind === 'gone' ? (
            <>
              {name} has no open maintenance reports in this snapshot; your claim on it expires{' '}
              {formatDate(claim.expiresAt)}. {release(claim)}
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
