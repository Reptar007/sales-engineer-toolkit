/**
 * Maintenance dashboard ("Bone Pile") -- routes.
 *
 * Read-only view of every customer's open QA Wolf maintenance reports, ranked
 * so an SE with a free afternoon can pick the oldest backlog or the customer
 * with the most tests parked. Mounted at /api/maintenance-dashboard.
 *
 * Authenticated, not role-gated: the page changes nothing in QA Wolf, and the
 * whole point is that any SE can look for work.
 */
import express from 'express';
import { authenticateToken } from '../../../middleware/auth.js';
import { getMaintenanceDashboard, startRefresh } from '../maintenanceService.js';

const router = express.Router();

function statusForError(error) {
  if (error?.code === 'QAW_AUTH') return 401;
  if (error?.code === 'QAW_CONFIG') return 500;
  if (error?.code === 'QAW_UPSTREAM' || error?.code === 'QAW_NETWORK') return 502;
  return 500;
}

// GET /api/maintenance-dashboard
// `{ status: 'ready', snapshot, builtAt, stale, refreshing, progress }` when a
// snapshot exists (a stale one still answers while a rebuild runs), or
// `{ status: 'building', progress }` during the first scan. `?refresh=1`
// forces a rescan in the background.
router.get('/', authenticateToken, (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const result = getMaintenanceDashboard({ refresh });
  if (result.status === 'error') {
    return res.status(statusForError(result.error)).json({
      status: 'error',
      error: result.error?.message || 'The maintenance backlog could not be read.',
      code: result.error?.code || null,
    });
  }
  return res.json(result);
});

// POST /api/maintenance-dashboard/refresh -- start a rescan (no-op if running).
router.post('/refresh', authenticateToken, (req, res) => {
  startRefresh();
  return res.status(202).json({ refreshing: true });
});

export default router;
