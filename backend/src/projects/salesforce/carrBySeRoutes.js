/**
 * CARR by SE — routes.
 *
 * Read and write the manual SE credit on QA Wolf's closed-won history. Mounted
 * at /api/salesforce/carr-by-se.
 *
 * Every route is authenticated but none is role-gated: attribution is a shared
 * data-entry exercise across ~400 rows going back to 2021, and gating writes to
 * admins would leave the SEs who actually remember those deals unable to record
 * them. `assignedByUserId` records who set each credit, so the history is
 * attributable even though the write is open.
 */
import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
  getCarrBySePayload,
  setAttribution,
  invalidateAllClosedWonCache,
} from './carrBySeService.js';

const router = express.Router();

/** Map a service error onto a status code; anything unrecognised is a 500. */
function statusForError(error) {
  if (error?.code === 'REPORT_SHAPE') return 502;
  if (error?.code === 'SF_REPORT') return 502;
  if (error?.code === 'UNKNOWN_SE') return 400;
  return 500;
}

// GET /api/salesforce/carr-by-se
// The whole page in one payload: rows tagged with their stored credit, the SE
// options, and the fiscal years present. `?refresh=1` bypasses the row cache.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const payload = await getCarrBySePayload({ refresh });
    return res.json(payload);
  } catch (error) {
    console.error('GET /salesforce/carr-by-se failed:', error);
    return res.status(statusForError(error)).json({ error: error.message });
  }
});

// PUT /api/salesforce/carr-by-se/attribution/:opportunityId
// Body: { salesEngineerId: string | null }  -- null clears the credit.
router.put('/attribution/:opportunityId', authenticateToken, async (req, res) => {
  const { opportunityId } = req.params;
  if (!opportunityId || !/^[a-zA-Z0-9]{15,18}$/.test(opportunityId)) {
    return res.status(400).json({ error: 'A valid Salesforce opportunity id is required.' });
  }

  const raw = req.body?.salesEngineerId;
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return res.status(400).json({ error: 'salesEngineerId must be a string or null.' });
  }
  const salesEngineerId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;

  try {
    const result = await setAttribution(opportunityId, salesEngineerId, {
      userId: req.user?.id,
      oppName: typeof req.body?.oppName === 'string' ? req.body.oppName : undefined,
    });
    return res.json(result);
  } catch (error) {
    console.error('PUT /salesforce/carr-by-se/attribution failed:', error);
    return res.status(statusForError(error)).json({ error: error.message });
  }
});

// POST /api/salesforce/carr-by-se/refresh -- drop the cached report rows.
router.post('/refresh', authenticateToken, (req, res) => {
  invalidateAllClosedWonCache();
  return res.json({ refreshed: true });
});

export default router;
