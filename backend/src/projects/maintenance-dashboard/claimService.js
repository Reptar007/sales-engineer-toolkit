/**
 * Claims on Bone Pile customers: an SE saying "I'm on this one" so the rest
 * of the team can see it is taken.
 *
 * Claims live in the app's database, not in the snapshot cache. The snapshot
 * is per-process and rebuilt every few hours, and a claim has to survive a
 * restart or a deploy; kept apart from it, a claim also shows on everyone's
 * next claims fetch without a rescan.
 *
 * A claim is accepted only for a customer in the current snapshot, which is
 * what the page lists, so nobody can claim a workspace id that has no
 * backlog. A workspace the snapshot's scan could not read is missing from it
 * too, though its backlog may not have cleared, so a claim already on one can
 * still be renewed; a new one waits for a scan that reads it. Releasing asks
 * nothing of the snapshot: it works straight after a restart, and for a
 * customer that has since left the backlog.
 *
 * A claim lapses at its `expiresAt`. Lapsed claims stop counting on every
 * read and are deleted on every write, so no job has to run on a schedule.
 *
 * Only the claim's owner, or an admin, may release it. The route is open to
 * any signed-in user, so the check is made here.
 */
import { getPrisma } from '../../lib/prisma.js';
import {
  findCachedCustomer,
  findUnreadWorkspace,
  getClaimDays,
  hasCachedSnapshot,
} from './maintenanceService.js';
import {
  CLAIM_NOTE_MAX_LENGTH,
  ClaimError,
  canReleaseClaim,
  claimExpiresAt,
  normalizeClaimNote,
  shapeClaim,
} from './claimShape.js';

let prismaOverride = null;

/** Test hook: every claim query goes to `client` (null restores the real one), so no test opens the tracked dev.db. */
export function setClaimsPrismaForTests(client) {
  prismaOverride = client;
}

const db = async () => prismaOverride || getPrisma();

/**
 * Every live claim, on every customer, as `viewer` sees it (`mine`,
 * `canRelease`), oldest first: `{ claims, claimDays, noteMaxLength }`. A
 * claim that has lapsed is left out, and so is one whose owner has been
 * deactivated; a claim on a customer no longer in the snapshot is listed, so
 * its owner can still see and release it. The claimer's email is never read.
 */
export async function listClaims(viewer, { now = Date.now() } = {}) {
  const rows = await (
    await db()
  ).maintenanceClaim.findMany({
    where: { expiresAt: { gt: new Date(now) }, user: { isActive: true } },
    select: {
      workspaceId: true,
      workspaceName: true,
      userId: true,
      note: true,
      createdAt: true,
      expiresAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return {
    claims: rows.map((row) => shapeClaim(row, viewer)),
    claimDays: getClaimDays(),
    noteMaxLength: CLAIM_NOTE_MAX_LENGTH,
  };
}

/** Delete the claims that have lapsed by `now`, anyone's. */
async function pruneExpired(prisma, now) {
  return prisma.maintenanceClaim.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
}

/**
 * Claim a customer for `viewer`, or renew their claim on it, for
 * MAINTENANCE_DASHBOARD_CLAIM_DAYS from `now`. A renewal keeps when it was
 * claimed. `rawNote` left out (undefined) keeps the stored note, or sets none
 * on a new claim; null or blank clears it; text replaces it, once
 * normalizeClaimNote has put it on one line.
 *
 * Refused with a ClaimError, before anything is written, for a note that is
 * not one (CLAIM_NOTE_INVALID), with no snapshot on this process
 * (CLAIM_NO_SNAPSHOT: it has restarted, and nobody has asked for the backlog
 * since, or its scan has not finished), for a workspace that is not a
 * customer in it (CLAIM_UNKNOWN_CUSTOMER), and for a new claim on one its
 * scan could not read (CLAIM_CUSTOMER_UNREAD), which a renewal gets past.
 * `lookup` is where the snapshot is asked, for tests.
 *
 * Answers the list as listClaims does, with the caller's `claim` on this
 * customer and whether it was a renewal (`renewed`).
 */
export async function claimCustomer(
  viewer,
  workspaceId,
  rawNote,
  {
    now = Date.now(),
    lookup = {
      hasSnapshot: hasCachedSnapshot,
      findCustomer: findCachedCustomer,
      findUnread: findUnreadWorkspace,
    },
  } = {},
) {
  const note = normalizeClaimNote(rawNote);
  if (!lookup.hasSnapshot()) {
    throw new ClaimError(
      'CLAIM_NO_SNAPSHOT',
      "The server has restarted and hasn't loaded the backlog since, so it can't check this customer yet. Try again once the backlog has been scanned.",
    );
  }
  const customer = lookup.findCustomer(workspaceId);
  const unread = customer ? null : lookup.findUnread(workspaceId);
  if (!customer && !unread) {
    throw new ClaimError(
      'CLAIM_UNKNOWN_CUSTOMER',
      "This customer has no open maintenance reports in the server's latest snapshot, so it can't be claimed.",
    );
  }

  const prisma = await db();
  const key = { workspaceId_userId: { workspaceId, userId: viewer.id } };
  // The caller's claim here, if it has not lapsed. A lapsed one is deleted
  // below, before the write, so claiming again after it is a new claim, with
  // its own claimedAt, not a renewal of the old one.
  const held = await prisma.maintenanceClaim.findUnique({
    where: key,
    select: { expiresAt: true },
  });
  let renewed = Boolean(held) && new Date(held.expiresAt).getTime() > now;
  if (!customer && !renewed) {
    throw new ClaimError(
      'CLAIM_CUSTOMER_UNREAD',
      "The server's latest scan couldn't read this customer from QA Wolf, so it can't be claimed until a scan does. A claim already on it can still be renewed.",
    );
  }
  await pruneExpired(prisma, now);

  const expiresAt = claimExpiresAt(now, getClaimDays());
  // The snapshot's name for the customer, or, for one its scan could not
  // read, the name QA Wolf listed it under; a renewal with neither keeps the
  // name the claim has.
  const workspaceName = customer?.name || unread?.workspaceName || null;
  const upsert = () =>
    prisma.maintenanceClaim.upsert({
      where: key,
      create: { workspaceId, workspaceName, userId: viewer.id, note: note ?? null, expiresAt },
      // An undefined field leaves the column as it is.
      update: { workspaceName: workspaceName ?? undefined, expiresAt, note },
    });
  try {
    await upsert();
  } catch (error) {
    // Two of the caller's tabs claimed at once, and the other one's row landed
    // between the lookup and this write: renew that row instead.
    if (error?.code !== 'P2002') throw error;
    await upsert();
    renewed = true;
  }

  const list = await listClaims(viewer, { now });
  return {
    ...list,
    claim: list.claims.find((c) => c.workspaceId === workspaceId && c.mine) ?? null,
    renewed,
  };
}

/**
 * Release the claim `userId` holds on a customer. Only its owner may, or an
 * admin (CLAIM_NOT_YOURS otherwise, decided before the database is asked).
 * A claim that is already gone, released or lapsed, is not a failure: the
 * answer says `released: false`, beside the list as listClaims gives it.
 */
export async function releaseClaim(viewer, workspaceId, userId, { now = Date.now() } = {}) {
  if (!canReleaseClaim(viewer, userId)) {
    throw new ClaimError(
      'CLAIM_NOT_YOURS',
      'Only the SE who made a claim, or an admin, can release it.',
    );
  }
  const prisma = await db();
  await pruneExpired(prisma, now);
  const { count } = await prisma.maintenanceClaim.deleteMany({ where: { workspaceId, userId } });
  return { released: count > 0, ...(await listClaims(viewer, { now })) };
}
