/**
 * The rules for a claim on a Bone Pile customer that need no database: what a
 * note may be, how a claimer is named, what a claim looks like on the wire,
 * and who may release one. Kept apart from claimService.js, as
 * maintenanceShape.js is from maintenanceService.js, so every rule is tested
 * without Prisma.
 */

export const CLAIM_NOTE_MAX_LENGTH = 140;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A claim request that was refused, and why, under a code the routes map to a status. */
export class ClaimError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClaimError';
    this.code = code;
  }
}

/**
 * A note as it is stored: one line of plain text, or null for none.
 * `undefined` is "leave the stored note alone" and comes back as it went in;
 * null, and text that is only whitespace, clear it. Control characters and
 * line breaks become spaces and runs of whitespace one space, so a note never
 * spans lines on the page, and a NUL, which Postgres text refuses, never
 * reaches the database. The length is counted after that, in UTF-16 units as
 * the page's input counts it, so the page can never send a note refused here.
 */
export function normalizeClaimNote(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ClaimError('CLAIM_NOTE_INVALID', 'A note must be text.');
  }
  const note = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!note) return null;
  if (note.length > CLAIM_NOTE_MAX_LENGTH) {
    throw new ClaimError(
      'CLAIM_NOTE_INVALID',
      `A note is at most ${CLAIM_NOTE_MAX_LENGTH} characters.`,
    );
  }
  return note;
}

/** A name part on one line, or '' for none. */
function namePart(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Who holds a claim, as the page shows it: first name and last initial,
 * "Robin V.". A user with no first name is "A teammate". The email is never
 * read, so it cannot stand in for a missing name.
 */
export function claimerName(user) {
  const first = namePart(user?.firstName);
  const last = namePart(user?.lastName);
  if (!first) return 'A teammate';
  return last ? `${first} ${[...last][0].toUpperCase()}.` : first;
}

/**
 * Whether `viewer` may release the claim `userId` holds: their own, or anyone's
 * for an admin, who may need to clear a claim its owner forgot. The one rule,
 * used for `canRelease` in every claim sent out and for the release itself.
 */
export function canReleaseClaim(viewer, userId) {
  return (Boolean(viewer?.id) && userId === viewer.id) || Boolean(viewer?.roles?.includes('admin'));
}

/** When a claim made or renewed at `now` (ms) lapses, `days` later. */
export function claimExpiresAt(now, days) {
  return new Date(now + days * DAY_MS);
}

const iso = (value) => new Date(value).toISOString();

/**
 * A claim as the routes send it, worked out for `viewer`: whether it is their
 * own (`mine`) and whether they may release it (`canRelease`). The claimer is
 * named by claimerName, and nothing else about them goes out: no email, no
 * full last name. The row's id and update time stay in the database.
 */
export function shapeClaim(row, viewer) {
  return {
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName ?? null,
    userId: row.userId,
    claimer: claimerName(row.user),
    note: row.note ?? null,
    claimedAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
    mine: row.userId === viewer.id,
    canRelease: canReleaseClaim(viewer, row.userId),
  };
}
