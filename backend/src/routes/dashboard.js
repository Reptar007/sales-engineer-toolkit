import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getClosedLinearTicketsForUser,
  getLinearBoardForDashboardForUser,
} from '../services/linearDashboardService.js';
import { getTodayCalendarForDashboard } from '../services/googleCalendarDashboardService.js';

const router = express.Router();

router.get('/linear', authenticateToken, async (req, res) => {
  try {
    const payload = await getLinearBoardForDashboardForUser(req.user.id);
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/linear:', err);
    res.status(500).json({ error: err.message || 'Failed to load Linear workload' });
  }
});

// Per-user closed-ticket roll-up (year + quarterly breakdown by category).
// Powers the team page's "Tickets closed by you" section. Year defaults to
// the current calendar year and is bounded between 2020 and 2035 so a
// malformed query string can't push the GraphQL into a bizarre window.
router.get('/linear/closed', authenticateToken, async (req, res) => {
  const now = new Date();
  const requestedYear = Number.parseInt(req.query.year, 10);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2035
      ? requestedYear
      : now.getUTCFullYear();
  try {
    const payload = await getClosedLinearTicketsForUser(req.user.id, year);
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/linear/closed:', err);
    res.status(500).json({ error: err.message || 'Failed to load closed tickets' });
  }
});

router.get('/calendar', authenticateToken, async (req, res) => {
  try {
    const payload = await getTodayCalendarForDashboard(req.user.id);
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/calendar:', err);
    res.status(500).json({ error: err.message || 'Failed to load calendar' });
  }
});

export default router;
