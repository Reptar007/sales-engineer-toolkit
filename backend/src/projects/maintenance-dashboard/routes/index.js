/**
 * Maintenance dashboard ("Bone Pile") -- routes.
 *
 * Read-only view of every customer's open QA Wolf maintenance reports, ranked
 * so an SE with a free afternoon can pick the oldest backlog or the customer
 * with the most tests parked, with Task Wolf's view (blocked vs actionable,
 * which QAE is already on it) folded in when a Task Wolf MCP token is set.
 * Mounted at /api/maintenance-dashboard.
 *
 * Authenticated, not role-gated: the page changes nothing in QA Wolf or Task
 * Wolf, and the whole point is that any SE can look for work.
 */
import express from 'express';
import { authenticateToken } from '../../../middleware/auth.js';
import {
  defaultTaskWolfClient,
  findCachedCustomer,
  getMaintenanceDashboard,
  probeTaskWolfCustomer,
  startRefresh,
} from '../maintenanceService.js';
import { getTaskWolfMcpUrl, isTaskWolfConfigured } from '../taskWolfMcpClient.js';

const router = express.Router();

function statusForError(error) {
  if (error?.code === 'QAW_AUTH' || error?.code === 'TW_AUTH') return 401;
  if (error?.code === 'QAW_CONFIG' || error?.code === 'TW_CONFIG') return 500;
  if (error?.code === 'TW_TOOL') return 400;
  if (
    error?.code === 'QAW_UPSTREAM' ||
    error?.code === 'QAW_NETWORK' ||
    error?.code === 'TW_UPSTREAM' ||
    error?.code === 'TW_NETWORK'
  ) {
    return 502;
  }
  return 500;
}

function sendError(res, error, fallback) {
  return res.status(statusForError(error)).json({
    status: 'error',
    error: error?.message || fallback,
    code: error?.code || null,
  });
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
    return sendError(res, result.error, 'The maintenance backlog could not be read.');
  }
  return res.json(result);
});

// POST /api/maintenance-dashboard/refresh -- start a rescan (no-op if running).
router.post('/refresh', authenticateToken, (req, res) => {
  startRefresh();
  return res.status(202).json({ refreshing: true });
});

// GET /api/maintenance-dashboard/taskwolf -- is Task Wolf wired up, and what
// does its MCP offer? Lists the server's tools with their input schemas (live,
// one `tools/list`), which is the first thing to look at when the Task Wolf
// column is empty.
router.get('/taskwolf', authenticateToken, async (req, res) => {
  if (!isTaskWolfConfigured()) {
    return res.json({
      configured: false,
      baseUrl: getTaskWolfMcpUrl(),
      message:
        'TASK_WOLF_MCP_TOKEN is not set. Mint one in Task Wolf -> Settings -> Connect Claude.',
    });
  }
  try {
    const client = defaultTaskWolfClient();
    const tools = await client.listTools({ force: req.query.refresh === '1' });
    return res.json({
      configured: true,
      baseUrl: client.baseUrl,
      serverInfo: client.getServerInfo(),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || null,
      })),
    });
  } catch (error) {
    return sendError(res, error, 'Task Wolf could not be reached.');
  }
});

// GET /api/maintenance-dashboard/taskwolf/customer/:workspaceId
// Live, uncached: the arguments derived from each tool's schema, the raw
// answer and the normalized reading for one customer. `?slug=` / `?name=`
// let a workspace that is not in the cached snapshot be probed too.
router.get('/taskwolf/customer/:workspaceId', authenticateToken, async (req, res) => {
  const { workspaceId } = req.params;
  const cached = findCachedCustomer(workspaceId);
  const workspace = {
    id: workspaceId,
    slug: cached?.slug || String(req.query.slug || ''),
    name: cached?.name || String(req.query.name || ''),
  };
  try {
    const result = await probeTaskWolfCustomer(workspace);
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Task Wolf could not be asked about this customer.');
  }
});

export default router;
