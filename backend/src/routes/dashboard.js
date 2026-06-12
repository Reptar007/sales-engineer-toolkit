import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getClosedLinearTicketsForUser,
  getClosedTicketsForAllSEs,
  getLinearBoardForDashboardForUser,
  getTicketsCreatedByAEForTeam,
  getTicketsForSE,
} from '../services/linearDashboardService.js';
import {
  getCalendarForSE,
  getTodayCalendarForDashboard,
} from '../services/googleCalendarDashboardService.js';
import { getPackCarr } from '../services/packCarrService.js';

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

// Team-wide tickets-created-by-AE roll-up. Powers the team page's
// "Tickets created broken down by AE" section. Year defaults to the
// current calendar year; bounds match `/linear/closed` so a malformed
// query string can't widen the GraphQL window arbitrarily.
router.get('/linear/tickets-by-ae', authenticateToken, async (req, res) => {
  const now = new Date();
  const requestedYear = Number.parseInt(req.query.year, 10);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2035
      ? requestedYear
      : now.getUTCFullYear();
  try {
    const payload = await getTicketsCreatedByAEForTeam(req.user.id, year);
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/linear/tickets-by-ae:', err);
    res.status(500).json({ error: err.message || 'Failed to load tickets by AE' });
  }
});

// Lead Pack overview: per-SE closed-ticket roll-up for every active Sales
// Engineer, plus each SE's assigned AE roster. Powers the team page's
// lead-only "Pack" view. Gated to SE leads only — everyone else (including
// admins) only sees their own team page, not the whole pack's numbers. Year
// defaults to the current calendar year with the same bounds as
// /linear/closed so a malformed query can't widen the GraphQL window.
router.get('/pack-overview', authenticateToken, async (req, res) => {
  const roles = req.user?.roles || [];
  if (!roles.includes('sales_engineer_lead')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const now = new Date();
  const requestedYear = Number.parseInt(req.query.year, 10);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2035
      ? requestedYear
      : now.getUTCFullYear();
  try {
    const payload = await getClosedTicketsForAllSEs(year);
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/pack-overview:', err);
    res.status(500).json({ error: err.message || 'Failed to load pack overview' });
  }
});

// Lead Pack CARR: per-SE Closed CARR roll-up, attributed via handoff pages
// (SF opportunityId -> Opp -> SE). Same SE-lead-only gate as /pack-overview.
// Year defaults to the current calendar year with the same bounds.
router.get('/pack-carr', authenticateToken, async (req, res) => {
  const roles = req.user?.roles || [];
  if (!roles.includes('sales_engineer_lead')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const now = new Date();
  const requestedYear = Number.parseInt(req.query.year, 10);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2035
      ? requestedYear
      : now.getUTCFullYear();
  try {
    const payload = await getPackCarr(year);
    res.json(payload);
  } catch (err) {
    console.error('GET /api/dashboard/pack-carr:', err);
    res.status(500).json({ error: err.message || 'Failed to load pack CARR' });
  }
});

// Pack drill-down: actual Linear tickets (open workload + closed-this-year)
// for a single Sales Engineer. Powers the team page's per-SE detail view.
// Same SE-lead-only gate as /pack-overview since it exposes another SE's work.
router.get('/pack-overview/:seId/tickets', authenticateToken, async (req, res) => {
  const roles = req.user?.roles || [];
  if (!roles.includes('sales_engineer_lead')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const now = new Date();
  const requestedYear = Number.parseInt(req.query.year, 10);
  const year =
    Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2035
      ? requestedYear
      : now.getUTCFullYear();
  try {
    const payload = await getTicketsForSE(req.params.seId, year);
    res.json(payload);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Sales Engineer not found' });
    }
    console.error('GET /api/dashboard/pack-overview/:seId/tickets:', err);
    res.status(500).json({ error: err.message || 'Failed to load SE tickets' });
  }
});

// Pack drill-down: today's calendar for a single Sales Engineer. Same
// SE-lead-only gate as the other pack-overview routes since it exposes another
// SE's schedule. Only reads the SE's own connected Google calendar.
router.get('/pack-overview/:seId/calendar', authenticateToken, async (req, res) => {
  const roles = req.user?.roles || [];
  if (!roles.includes('sales_engineer_lead')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  try {
    const payload = await getCalendarForSE(req.params.seId);
    res.json(payload);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Sales Engineer not found' });
    }
    console.error('GET /api/dashboard/pack-overview/:seId/calendar:', err);
    res.status(500).json({ error: err.message || 'Failed to load SE calendar' });
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
