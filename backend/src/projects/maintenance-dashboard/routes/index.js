/**
 * Maintenance dashboard ("Bone Pile") -- routes.
 *
 * The page lists every customer's open QA Wolf maintenance reports, ranked so
 * an SE with a free afternoon can pick the oldest backlog or the customer
 * with the most tests parked, with Task Wolf's view (blocked vs actionable,
 * which QAE is already on it) folded in when a Task Wolf MCP token is set,
 * and who on the team has claimed which customer.
 * Mounted at /api/maintenance-dashboard.
 *
 * It changes nothing in QA Wolf or Task Wolf. Claims are the one thing it
 * writes, to this app's own database.
 *
 * The page's routes are authenticated, not role-gated: the whole point is that
 * any SE can look for work and claim it. A user releases only their own claim,
 * and an admin anyone's; claimService checks that, because the route is open
 * to the claim's owner, whoever they are. The two Task Wolf diagnostics routes
 * are admin-only, because they ask Task Wolf live, on the server's token,
 * about any customer named in the path, and hand back the raw answer.
 */
import express from 'express';
import { authenticateToken } from '../../../middleware/auth.js';
import { requireRole } from '../../../middleware/rbac.js';
import {
  defaultTaskWolfClient,
  findCachedCustomer,
  getMaintenanceDashboard,
  getMaintenanceStatus,
  probeTaskWolfCustomer,
  requestRescan,
} from '../maintenanceService.js';
import {
  getTaskWolfMcpUrl,
  getTaskWolfTokenExpiry,
  isTaskWolfConfigured,
} from '../taskWolfMcpClient.js';
import { claimCustomer, listClaims, releaseClaim } from '../claimService.js';
import { ClaimError } from '../claimShape.js';

const router = express.Router();

/** The HTTP status a failure answers under, by its code. Exported for tests. */
export function statusForError(error) {
  if (error?.code === 'QAW_AUTH' || error?.code === 'TW_AUTH') return 401;
  if (error?.code === 'QAW_CONFIG' || error?.code === 'TW_CONFIG') return 500;
  // A 403 upstream is 502 here, not 403: QA Wolf or Task Wolf refused our key,
  // which says nothing about the session of whoever is asking us. TW_TOOL only
  // reaches a route as Task Wolf answering the handshake or tools/list with a
  // JSON-RPC error, which is its failure, not a bad request of the caller's.
  if (
    error?.code === 'QAW_UPSTREAM' ||
    error?.code === 'QAW_NETWORK' ||
    error?.code === 'QAW_FORBIDDEN' ||
    error?.code === 'TW_UPSTREAM' ||
    error?.code === 'TW_NETWORK' ||
    error?.code === 'TW_FORBIDDEN' ||
    error?.code === 'TW_TOOL'
  ) {
    return 502;
  }
  if (error?.code === 'CLAIM_NOTE_INVALID') return 400;
  if (error?.code === 'CLAIM_NOT_YOURS') return 403;
  if (error?.code === 'CLAIM_UNKNOWN_CUSTOMER') return 404;
  // The server has no snapshot yet (it has just restarted), so it cannot say
  // who the customers are, or its scan could not read this one; the same
  // request works once a scan has.
  if (error?.code === 'CLAIM_NO_SNAPSHOT' || error?.code === 'CLAIM_CUSTOMER_UNREAD') return 409;
  return 500;
}

/**
 * The token's expiry as the admin route reports it: what the page is told,
 * and a sentence where the setting needs looking at, since the page says
 * nothing of a date it cannot read, or of none.
 */
function tokenExpiryReport() {
  const expiry = getTaskWolfTokenExpiry();
  let message = null;
  if (expiry.state === 'invalid') {
    message =
      'TASK_WOLF_MCP_TOKEN_EXPIRES_ON is not a YYYY-MM-DD date, so the page gives no warning before the token expires.';
  } else if (expiry.state === 'none' && isTaskWolfConfigured()) {
    message =
      'TASK_WOLF_MCP_TOKEN_EXPIRES_ON is not set, so the page gives no warning before the token expires.';
  }
  return { ...expiry, message };
}

/** A failure as the routes answer it; `extra` is what a route says beside it. */
function sendError(res, error, fallback, extra = {}) {
  return res.status(statusForError(error)).json({
    status: 'error',
    error: error?.message || fallback,
    code: error?.code || null,
    ...extra,
  });
}

/**
 * A claim route's failure. A ClaimError says what was wrong; anything else is
 * the database, whose message (table and constraint names) is logged, never
 * sent.
 */
function sendClaimError(res, error, fallback) {
  if (error instanceof ClaimError) return sendError(res, error, fallback);
  console.error('Bone Pile claims failed:', error);
  return sendError(res, new ClaimError('CLAIMS_UNAVAILABLE', fallback), fallback);
}

// GET /api/maintenance-dashboard
// `{ status: 'ready', snapshot, builtAt, stale, refreshing, progress,
// refreshError, rescanAvailableAt }` when a snapshot exists (a stale one still
// answers while a rebuild runs, and `refreshError` says so when the last
// rebuild failed), or `{ status: 'building', progress, refreshError }` during
// the first scan. With no snapshot and a failed scan it answers `{ status:
// 'error', error, code, failedAt, rescanAvailableAt, taskWolfToken }` under the
// matching HTTP status until the cool-down passes. `refreshError` stays while
// the retry runs and clears once a scan publishes a snapshot. Every answer
// carries `taskWolfToken`, `{ expiresOn, daysLeft, state }` or null, from
// TASK_WOLF_MCP_TOKEN_EXPIRES_ON. `?refresh=1` asks for a rescan in the
// background, which starts only once `rescanAvailableAt` has passed; refused,
// it is a plain GET, which rebuilds a snapshot past the cache window. The
// answer is the same either way.
router.get('/', authenticateToken, (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const result = getMaintenanceDashboard({ refresh });
  if (result.status === 'error') {
    return sendError(res, result.error, 'The maintenance backlog could not be read.', {
      failedAt: result.error.failedAt || null,
      rescanAvailableAt: result.rescanAvailableAt,
      taskWolfToken: result.taskWolfToken,
    });
  }
  return res.json(result);
});

// GET /api/maintenance-dashboard/status
// What the page polls while a scan runs: `{ status, builtAt, stale,
// refreshing, progress, refreshError, rescanAvailableAt, taskWolfToken, error }`
// and never the snapshot, which is megabytes at production size. Always 200,
// a failed scan included (it is in `error`, as `{ code, message, failedAt }`, or in
// `refreshError` beside a snapshot or a retry that is running), and it never
// starts a scan. Fetch the full payload above when `builtAt` moves or
// `refreshing` turns false.
router.get('/status', authenticateToken, (req, res) => res.json(getMaintenanceStatus()));

// POST /api/maintenance-dashboard/refresh -- start a rescan, or join the one
// running. Each scan is about 2,000 QA Wolf calls, so one asked for within
// MAINTENANCE_DASHBOARD_MIN_RESCAN_MINUTES of the last snapshot (or the retry
// cool-down of a failed scan) answers 429 with Retry-After instead.
router.post('/refresh', authenticateToken, (req, res) => {
  const { accepted, retryAfterMs } = requestRescan();
  if (!accepted) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      refreshing: false,
      error: 'A scan ran recently. Try again later.',
      code: 'RESCAN_TOO_SOON',
      retryAfterSeconds,
    });
  }
  return res.status(202).json({ refreshing: true });
});

// GET /api/maintenance-dashboard/claims
// Every live claim, on every customer, as the caller sees it: `{ claims,
// claimDays, noteMaxLength }`, each claim `{ workspaceId, workspaceName,
// userId, claimer, note, claimedAt, expiresAt, mine, canRelease }`, oldest
// first. Read from the database every time, apart from the snapshot: it never
// starts a scan and never waits on one, so the page can poll it, and a claim
// shows for everyone on their next poll. Claims on customers that have left
// the snapshot are listed too. A database failure is 500 CLAIMS_UNAVAILABLE.
router.get('/claims', authenticateToken, async (req, res) => {
  try {
    return res.json(await listClaims(req.user));
  } catch (error) {
    return sendClaimError(res, error, 'Claims could not be read.');
  }
});

// PUT /api/maintenance-dashboard/claims/:workspaceId -- claim a customer, or
// renew the caller's own claim on it, for claimDays from now. Body `{ note? }`:
// left out, the note stays as it is (none on a new claim); null or blank
// clears it; text replaces it, put on one line, at most 140 characters (400
// CLAIM_NOTE_INVALID past that). Only a customer in the server's snapshot can
// be claimed: 409 CLAIM_NO_SNAPSHOT while there is none (after a restart,
// until GET / has started a scan and it has published one), 404
// CLAIM_UNKNOWN_CUSTOMER for a workspace not in it, and 409
// CLAIM_CUSTOMER_UNREAD for a new claim on a workspace its scan could not
// read, where a claim already made can still be renewed. This route starts no
// scan. Answers the list as GET /claims does, with the caller's `claim` and
// whether it was `renewed`.
router.put('/claims/:workspaceId', authenticateToken, async (req, res) => {
  try {
    // JSON has no undefined, so `note` is undefined exactly when it was left
    // out; Express 5 leaves `req.body` undefined when there was no body.
    return res.json(await claimCustomer(req.user, req.params.workspaceId, req.body?.note));
  } catch (error) {
    return sendClaimError(res, error, 'The claim could not be saved.');
  }
});

// DELETE /api/maintenance-dashboard/claims/:workspaceId/:userId -- release a
// claim: the caller's own, or anyone's for an admin (403 CLAIM_NOT_YOURS
// otherwise). The snapshot is not asked, so this works after a restart and
// for a customer that has left the backlog. A claim already gone (released or
// lapsed) answers 200 with `released: false`, beside the list as GET /claims
// gives it.
router.delete('/claims/:workspaceId/:userId', authenticateToken, async (req, res) => {
  try {
    return res.json(await releaseClaim(req.user, req.params.workspaceId, req.params.userId));
  } catch (error) {
    return sendClaimError(res, error, 'The claim could not be released.');
  }
});

// GET /api/maintenance-dashboard/taskwolf -- is Task Wolf wired up, and what
// does its MCP offer? Lists the server's tools with their input schemas (live,
// one `tools/list`), which is the first thing to look at when the Task Wolf
// column is empty. `tokenExpiry` (`{ expiresOn, daysLeft, state, message }`)
// says where the token stands against TASK_WOLF_MCP_TOKEN_EXPIRES_ON, beside
// a failure too, and `message` says when that setting is missing or unreadable.
router.get('/taskwolf', authenticateToken, requireRole('admin'), async (req, res) => {
  const tokenExpiry = tokenExpiryReport();
  if (!isTaskWolfConfigured()) {
    return res.json({
      configured: false,
      baseUrl: getTaskWolfMcpUrl(),
      message:
        'TASK_WOLF_MCP_TOKEN is not set. Mint one in Task Wolf -> Settings -> Connect Claude.',
      tokenExpiry,
    });
  }
  try {
    const client = defaultTaskWolfClient();
    const tools = await client.listTools({ force: req.query.refresh === '1' });
    return res.json({
      configured: true,
      baseUrl: client.baseUrl,
      serverInfo: client.getServerInfo(),
      tokenExpiry,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || null,
      })),
    });
  } catch (error) {
    return sendError(res, error, 'Task Wolf could not be reached.', { tokenExpiry });
  }
});

// GET /api/maintenance-dashboard/taskwolf/customer/:workspaceId
// Live, uncached: each tool's schema, the arguments it is sent, the raw answer
// and the normalized reading for one customer. The workspace id goes to Task
// Wolf as its qawId, in `customer`; the slug and name, when the snapshot has
// the customer, only label the answer. Admin-only: it asks Task Wolf on the
// server's token.
router.get(
  '/taskwolf/customer/:workspaceId',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    const { workspaceId } = req.params;
    const cached = findCachedCustomer(workspaceId);
    const workspace = { id: workspaceId, slug: cached?.slug || '', name: cached?.name || '' };
    try {
      const result = await probeTaskWolfCustomer(workspace);
      return res.json(result);
    } catch (error) {
      return sendError(res, error, 'Task Wolf could not be asked about this customer.');
    }
  },
);

export default router;
