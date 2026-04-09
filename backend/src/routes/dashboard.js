import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getLinearBoardForDashboard } from '../services/linearDashboardService.js';
import { getTodayCalendarEvents } from '../services/googleCalendarDashboardService.js';

const router = express.Router();

router.get('/linear', authenticateToken, async (req, res) => {
  try {
    const payload = await getLinearBoardForDashboard();
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/linear:', err);
    res.status(500).json({ error: err.message || 'Failed to load Linear workload' });
  }
});

router.get('/calendar', authenticateToken, async (req, res) => {
  try {
    const payload = await getTodayCalendarEvents();
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/calendar:', err);
    res.status(500).json({ error: err.message || 'Failed to load calendar' });
  }
});

export default router;
