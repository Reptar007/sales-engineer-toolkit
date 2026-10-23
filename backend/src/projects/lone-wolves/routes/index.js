/**
 * Lone Wolves (self-serve onboarding) -- routes.
 *
 * The page lists every self-serve, custom-contract and pilot workspace with
 * its onboarding health: activation steps against kickoff, flows, runs,
 * environments, triggers and bugs. Mounted at /api/lone-wolves.
 *
 * It reads QA Wolf and Task Wolf and changes nothing in either. The one thing
 * it writes is its own record of each workspace (kickoff date, pilot length,
 * failure owner, ticket), to this app's database. Any signed-in user may
 * read and record; the page is the onboarding team's working list.
 */
import express from 'express';
import { authenticateToken } from '../../../middleware/auth.js';
import { statusForError } from '../../maintenance-dashboard/routes/index.js';
import { getOnboardingDashboard, requestRescan, startRefresh } from '../onboardingService.js';
import { OnboardingError, addWorkspace, isWorkspaceId, saveDetails } from '../workspaceStore.js';
import { listEnvironments } from '../platformClient.js';

const router = express.Router();

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
// `?refresh=1` asks for a rescan in the background.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const result = await getOnboardingDashboard({ refresh });
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
router.post('/refresh', authenticateToken, (req, res) => {
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
router.get('/workspaces/:workspaceId/environments', authenticateToken, async (req, res) => {
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
        .map((env) => ({ id: env.id, name: env.name, isDefault: env.id === defaultEnvironmentId })),
    });
  } catch (error) {
    return sendError(res, error, 'The environments could not be read.');
  }
});

// PUT /api/lone-wolves/workspaces/:workspaceId -- record details. Only the
// fields sent change; an empty value clears one. `hidden: true` takes the
// workspace off the page. Changing `environmentId` starts a rescan, since
// the cached numbers are the old environment's.
router.put('/workspaces/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const row = await saveDetails(req.params.workspaceId, req.body || {}, req.user);
    if (req.body && 'environmentId' in req.body) startRefresh();
    return res.json({ status: 'ok', details: row });
  } catch (error) {
    return sendError(res, error, 'The details could not be saved.');
  }
});

// POST /api/lone-wolves/workspaces -- add a workspace from another QA team
// by id (a pilot, a self-managed workspace in a full-service account). It is
// scanned in the background and shows as "Not scanned yet" until then.
router.post('/workspaces', authenticateToken, async (req, res) => {
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
