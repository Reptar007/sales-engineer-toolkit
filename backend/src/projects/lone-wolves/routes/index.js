/**
 * Lone Wolves (self-serve onboarding) -- routes.
 *
 * The page lists every self-serve, custom-contract and pilot workspace with
 * its onboarding health: activation steps against kickoff, flows, runs,
 * environments, triggers and bugs. Mounted at /api/lone-wolves.
 *
 * It reads QA Wolf and Task Wolf and changes nothing in either. The one thing
 * it writes is its own record of each workspace (kickoff date, pilot length,
 * failure owner, ticket, pricing), to this app's database.
 *
 * Any signed-in user may read it, CSMs included. Writing (details, adding a
 * workspace, rescans, the live environment lookup that adding needs) is for
 * editors only: admins and the CSM lead, as Becca asked (10/28); CSMs may
 * also switch a workspace's pricing. `canEdit` and `canPrice` on the GET
 * answer tell the page which it is showing.
 *
 * Billing's AI credits come from Metronome over a connection only an admin
 * makes (metronomeConnection.js); once it is up, anyone who may price a
 * workspace pulls with one click and never sees Metronome.
 */
import express from 'express';
import { authenticateToken } from '../../../middleware/auth.js';
import { CSM_ROLES, requireRole } from '../../../middleware/rbac.js';
import { getPrisma } from '../../../lib/prisma.js';
import { statusForError } from '../../maintenance-dashboard/routes/index.js';
import { getOnboardingDashboard, requestRescan, startRefresh } from '../onboardingService.js';
import {
  OnboardingError,
  addWorkspace,
  isWorkspaceId,
  listDetails,
  saveDetails,
  saveMeteredWeeks,
} from '../workspaceStore.js';
import { parseMeteredCsv } from '../meteredImport.js';
import {
  connectMetronome,
  connectionStatus,
  disconnectMetronome,
  metronomeToken,
} from '../metronomeConnection.js';
import { pullEvery, pullStatus, startPull } from '../metronomePull.js';
import { listEnvironments } from '../platformClient.js';

const router = express.Router();

/** Who may change Lone Wolves; requireRole lets admins through as well. */
export const EDITOR_ROLES = ['csm_lead'];
const requireEditor = requireRole(EDITOR_ROLES);
/** requireRole lets admins through whatever it is given; nobody else is listed. */
const requireAdmin = requireRole([]);

const isAdmin = (user) => (user?.roles || []).includes('admin');

/** Whether a signed-in user may edit, by the same rule as requireEditor. */
export function canEditLoneWolves(user) {
  const roles = user?.roles || [];
  return roles.includes('admin') || EDITOR_ROLES.some((role) => roles.includes(role));
}

/**
 * Whether a signed-in user may switch a workspace's pricing (old / new /
 * none): editors, and any CSM, who shows the customer the number (Becca,
 * 10/28). The pick is saved for everyone, like the other details.
 */
export function canPriceLoneWolves(user) {
  return canEditLoneWolves(user) || (user?.roles || []).some((role) => CSM_ROLES.includes(role));
}

/** Let a Metronome pull through: anyone who may price a workspace, CSMs included. */
export function requirePuller(req, res, next) {
  if (canPriceLoneWolves(req.user)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
}

/**
 * Let a details save through: editors change anything; a CSM changes
 * pricing and nothing else.
 */
export function requireDetailsAccess(req, res, next) {
  if (canEditLoneWolves(req.user)) return next();
  const keys = Object.keys(req.body || {});
  if (canPriceLoneWolves(req.user) && keys.length === 1 && keys[0] === 'pricing') return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
}

function sendError(res, error, fallback) {
  if (error instanceof OnboardingError) {
    return res.status(400).json({ status: 'error', error: error.message, code: error.code });
  }
  if (!error?.code) console.error('Lone Wolves failed:', error);
  return res.status(error?.code ? statusForError(error) : 500).json({
    status: 'error',
    error: error?.code ? error.message : fallback,
    code: error?.code || null,
  });
}

// GET /api/lone-wolves
// `{ status: 'ready', builtAt, refreshing, refreshError, taskWolf, warnings,
// summary, rows }` once a scan exists, `{ status: 'building' }` during the
// first, or an error with `failedAt` when there is no scan and it failed.
// `?refresh=1` asks for a rescan in the background (editors only; anyone
// else's is ignored). Every answer carries `canEdit`, `canPrice`, `metronome`
// (whether the server is connected to Metronome, never the code) and
// `canConnectMetronome` (admins).
router.get('/', authenticateToken, async (req, res) => {
  try {
    const canEdit = canEditLoneWolves(req.user);
    const refresh = canEdit && (req.query.refresh === '1' || req.query.refresh === 'true');
    const canPrice = canPriceLoneWolves(req.user);
    const result = {
      ...(await getOnboardingDashboard({ refresh })),
      canEdit,
      canPrice,
      metronome: connectionStatus(),
      canConnectMetronome: isAdmin(req.user),
    };
    if (result.status === 'error') {
      return res.status(statusForError(result.error)).json({
        status: 'error',
        error: result.error?.message || 'The onboarding scan failed.',
        code: result.error?.code || null,
        failedAt: result.failedAt,
      });
    }
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'The onboarding page could not be read.');
  }
});

// POST /api/lone-wolves/refresh -- 202 when a rescan starts, 429 with
// Retry-After (seconds) when one ran too recently or is running.
router.post('/refresh', authenticateToken, requireEditor, (req, res) => {
  const { accepted, retryAfterMs } = requestRescan();
  if (!accepted) {
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return res
      .status(429)
      .json({ status: 'error', error: 'A scan ran moments ago.', retryAfterMs });
  }
  return res.status(202).json({ status: 'accepted' });
});

// GET /api/lone-wolves/workspaces/:workspaceId/environments -- the
// workspace's static environments, live from QA Wolf, for the environment
// picker when adding a workspace (before any scan has read it):
// `{ environments: [{ id, name, isDefault }], defaultEnvironmentId }`.
router.get(
  '/workspaces/:workspaceId/environments',
  authenticateToken,
  requireEditor,
  async (req, res) => {
    try {
      if (!isWorkspaceId(req.params.workspaceId)) {
        throw new OnboardingError('ONBOARDING_INVALID', 'That is not a QA Wolf workspace id.');
      }
      const { environments, defaultEnvironmentId } = await listEnvironments(req.params.workspaceId);
      return res.json({
        status: 'ok',
        defaultEnvironmentId,
        environments: environments
          .filter((env) => env?.kind !== 'preview')
          .map((env) => ({
            id: env.id,
            name: env.name,
            isDefault: env.id === defaultEnvironmentId,
          })),
      });
    } catch (error) {
      return sendError(res, error, 'The environments could not be read.');
    }
  },
);

// GET /api/lone-wolves/csms -- the active CSM and CSM lead accounts, for
// the CSM picker on a workspace (editors only): `{ csms: [{ id, name,
// email }] }`. A workspace's CSM is saved as the name, which is what a
// CSM's dashboard matches to find their clients.
router.get('/csms', authenticateToken, requireEditor, async (req, res) => {
  try {
    const prisma = await getPrisma();
    const users = await prisma.user.findMany({
      where: { isActive: true, userRoles: { some: { role: { in: ['csm', 'csm_lead'] } } } },
      select: { id: true, email: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return res.json({
      status: 'ok',
      csms: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      })),
    });
  } catch (error) {
    return sendError(res, error, 'The CSMs could not be listed.');
  }
});

// PUT /api/lone-wolves/workspaces/:workspaceId -- record details. Only the
// fields sent change; an empty value clears one. `hidden: true` takes the
// workspace off the page. Sending `environmentId` or `kickoffOn` starts a
// rescan, since the cached usage was counted for the old environment and
// the old window of weeks; the page sends them only when they change. A CSM
// may send `{ pricing }` alone; everything else is for editors.
router.put(
  '/workspaces/:workspaceId',
  authenticateToken,
  requireDetailsAccess,
  async (req, res) => {
    try {
      const row = await saveDetails(req.params.workspaceId, req.body || {}, req.user);
      if (req.body && ('environmentId' in req.body || 'kickoffOn' in req.body)) startRefresh();
      return res.json({ status: 'ok', details: row });
    } catch (error) {
      return sendError(res, error, 'The details could not be saved.');
    }
  },
);

// POST /api/lone-wolves/workspaces/:workspaceId/metered -- import billing's
// weekly AI credits and interactive minutes for the environment the row
// counts: `{ environmentId, csv }`, csv being the by-week file of the
// Metronome usage script. Weeks in the file replace those already imported.
// Answers the weeks it kept. Shows on the next read; no rescan needed.
router.post(
  '/workspaces/:workspaceId/metered',
  authenticateToken,
  requireEditor,
  async (req, res) => {
    try {
      const { environmentId, csv } = req.body || {};
      const weeks = parseMeteredCsv(csv);
      await saveMeteredWeeks(req.params.workspaceId, environmentId, weeks, req.user);
      return res.json({
        status: 'ok',
        weeks: weeks.map((w) => ({ ...w, weekStart: new Date(w.weekStart).toISOString() })),
      });
    } catch (error) {
      return sendError(res, error, 'The usage file could not be imported.');
    }
  },
);

// PUT /api/lone-wolves/metronome -- connect the server to Metronome with the
// code from an admin's Metronome session: `{ token, pullAll }`. Kept in
// memory until it runs out (about a day). With `pullAll`, every card with
// Metronome ids and an environment is pulled, one after another, in the
// background. Answers the connection (never the code) and how many pulls
// were queued.
router.put('/metronome', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { token, pullAll } = req.body || {};
    const connection = connectMetronome(token, req.user);
    let queued = 0;
    if (pullAll) {
      const dashboard = await getOnboardingDashboard();
      const targets = (dashboard.rows || [])
        .filter((row) => row.environmentId && row.metronomeAliases)
        .map((row) => ({
          workspaceId: row.workspaceId,
          environmentId: row.environmentId,
          aliases: row.metronomeAliases,
          kickoffOn: row.kickoffOn,
        }));
      queued = targets.length;
      pullEvery(targets, { token: metronomeToken(), viewer: req.user }).catch((error) =>
        console.error('Metronome pull of every workspace failed:', error.message),
      );
    }
    return res.json({ status: 'ok', metronome: connection, queued });
  } catch (error) {
    return sendError(res, error, 'Metronome could not be connected.');
  }
});

// DELETE /api/lone-wolves/metronome -- forget the code now.
router.delete('/metronome', authenticateToken, requireAdmin, (req, res) => {
  disconnectMetronome();
  return res.json({ status: 'ok', metronome: connectionStatus() });
});

// POST /api/lone-wolves/workspaces/:workspaceId/metered/pull -- pull billing's
// AI credits and interactive minutes from Metronome in the background, over
// the server's connection: `{ environmentId }`. Editors and CSMs. 202 with
// the pull's status; 409 while one is running; 400 with code
// METRONOME_NOT_CONNECTED when no admin has connected Metronome.
router.post(
  '/workspaces/:workspaceId/metered/pull',
  authenticateToken,
  requirePuller,
  async (req, res) => {
    try {
      const { workspaceId } = req.params;
      if (!isWorkspaceId(workspaceId)) {
        throw new OnboardingError('ONBOARDING_INVALID', 'That is not a QA Wolf workspace id.');
      }
      const { environmentId } = req.body || {};
      const details = (await listDetails()).find((d) => d.workspaceId === workspaceId) || {};
      const { status } = startPull({
        workspaceId,
        environmentId,
        aliases: details.metronomeAliases,
        kickoffOn: details.kickoffOn,
        token: metronomeToken(),
        viewer: req.user,
      });
      return res.status(202).json({ status: 'ok', pull: status });
    } catch (error) {
      if (error?.code === 'ONBOARDING_BUSY') {
        return res.status(409).json({ status: 'error', error: error.message, code: error.code });
      }
      return sendError(res, error, 'The pull could not start.');
    }
  },
);

// GET /api/lone-wolves/workspaces/:workspaceId/metered/pull -- where the
// workspace's last pull stands: idle, running (with its step and events
// read so far), done (with the weeks kept) or failed (with why).
router.get('/workspaces/:workspaceId/metered/pull', authenticateToken, requirePuller, (req, res) =>
  res.json({ status: 'ok', pull: pullStatus(req.params.workspaceId) }),
);

// POST /api/lone-wolves/workspaces -- add a workspace from another QA team
// by id (a pilot, a self-managed workspace in a full-service account). It is
// scanned in the background and shows as "Not scanned yet" until then.
router.post('/workspaces', authenticateToken, requireEditor, async (req, res) => {
  try {
    const { workspaceId, ...details } = req.body || {};
    const row = await addWorkspace(workspaceId, details, req.user);
    startRefresh();
    return res.status(201).json({ status: 'ok', details: row });
  } catch (error) {
    return sendError(res, error, 'The workspace could not be added.');
  }
});

export default router;
