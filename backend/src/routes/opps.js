import express from 'express';
import { getPrisma } from '../lib/prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { canEditOpp, requireOppEdit } from '../middleware/oppAccess.js';
import {
  findLinearTicketsForOpp,
  getMyOppNamesFromLinear,
  getLinearTicketByIdentifier,
  mergeManualLinearLinks,
  parseLinearIdentifier,
  listMyOpenLinearTickets,
} from '../services/linearDashboardService.js';
import {
  isConfigured as isNotionConfigured,
  createOppPage as createNotionOppPage,
  updateOppPage as updateNotionOppPage,
  archiveOppPage as archiveNotionOppPage,
} from '../services/notionService.js';
import { anthropicService } from '../services/anthropicService.js';

const router = express.Router();

// All routes require auth. Edit gating is layered on top by requireOppEdit.
router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Default custom-sections payload seeded on Opp creation. Pain Points is
// pre-seeded so SEs always see the prompt without having to click "Add
// section"; the Slack-handoff template looks it up by title.
const DEFAULT_CUSTOM_SECTIONS = [
  { id: 'pain-points', title: 'Pain Points', bodyMarkdown: '', order: 0 },
];

// JSON-string fields are stored as TEXT in SQLite. These two helpers keep
// the parse/stringify discipline in one place so every route returns the
// same shape (object/array) regardless of NULLs in the DB.
function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeOpp(opp, viewer) {
  return {
    id: opp.id,
    oppName: opp.oppName,
    salesforceOpportunityId: opp.salesforceOpportunityId,
    aeNameOverride: opp.aeNameOverride,
    csmName: opp.csmName,
    qaLeadName: opp.qaLeadName,
    qaManagerName: opp.qaManagerName,
    technicalSpecs: parseJson(opp.technicalSpecsJson, {}),
    qawTeam: opp.qawTeam || null,
    notesMarkdown: opp.notesMarkdown || '',
    customSections: parseJson(opp.customSectionsJson, []),
    manualLinearLinks: parseJson(opp.manualLinearLinksJson, []),
    // Default both to empty-shape objects so the FE never has to null-check
    // before rendering -- it just sees `creation.flows = []` etc.
    creation: parseJson(opp.creationJson, { demoWorkspaceUrl: '', flows: [] }),
    estimation: parseJson(opp.estimationJson, {
      type: null,
      ratioDocUrl: '',
      exploratoryNotes: '',
      spreadsheetUrl: '',
    }),
    notionPageId: opp.notionPageId || null,
    notionPageUrl: opp.notionPageUrl || null,
    notionSyncedAt: opp.notionSyncedAt || null,
    currentStage: opp.currentStage || null,
    stageSyncedAt: opp.stageSyncedAt || null,
    archivedAt: opp.archivedAt,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
    salesEngineer: opp.salesEngineer
      ? {
          id: opp.salesEngineer.id,
          userId: opp.salesEngineer.userId,
          firstName: opp.salesEngineer.user?.firstName || null,
          lastName: opp.salesEngineer.user?.lastName || null,
          email: opp.salesEngineer.user?.email || null,
        }
      : null,
    canEdit: viewer ? canEditOpp(viewer, opp) : false,
  };
}

// Sparse-row variant for the team directory table -- only the columns the
// table actually renders, so the list endpoint stays cheap.
function serializeOppRow(opp) {
  return {
    id: opp.id,
    oppName: opp.oppName,
    salesforceOpportunityId: opp.salesforceOpportunityId,
    // The Hunt Board renders a stage pill from this; without it the column
    // always shows "—" even when the snapshot exists on the row.
    currentStage: opp.currentStage || null,
    stageSyncedAt: opp.stageSyncedAt || null,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
    archivedAt: opp.archivedAt,
    salesEngineer: opp.salesEngineer
      ? {
          id: opp.salesEngineer.id,
          userId: opp.salesEngineer.userId,
          firstName: opp.salesEngineer.user?.firstName || null,
          lastName: opp.salesEngineer.user?.lastName || null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// GET /opps/sales-engineers  -- list of SEs for the reassignment picker.
// Admins / Leads only since regular SEs can't reassign anyway.
// Routed BEFORE the dynamic /opps/:id below so "sales-engineers" doesn't
// get caught as an opp id.
// ---------------------------------------------------------------------------
router.get('/sales-engineers', async (req, res) => {
  const roles = req.user?.roles || [];
  if (!roles.includes('admin') && !roles.includes('sales_engineer_lead')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  try {
    const prisma = await getPrisma();
    const ses = await prisma.salesEngineer.findMany({
      where: { isActive: true },
      include: { user: true },
      orderBy: { id: 'asc' },
    });
    const data = ses
      .map((se) => ({
        id: se.id,
        userId: se.userId,
        firstName: se.user?.firstName || null,
        lastName: se.user?.lastName || null,
        email: se.user?.email || null,
      }))
      .sort((a, b) => {
        const an = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
        const bn = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
        return an.localeCompare(bn);
      });
    return res.json({ salesEngineers: data });
  } catch (err) {
    console.error('GET /opps/sales-engineers failed:', err);
    return res.status(500).json({ error: 'Failed to list sales engineers' });
  }
});

// ---------------------------------------------------------------------------
// GET /opps  -- team-wide directory
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { search, seId, includeArchived } = req.query;
    const where = {};
    if (!includeArchived) where.archivedAt = null;
    if (seId) where.salesEngineerId = String(seId);
    if (search && String(search).trim()) {
      where.oppName = { contains: String(search).trim() };
    }
    const opps = await prisma.opp.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { salesEngineer: { include: { user: true } } },
    });
    return res.json({ opps: opps.map(serializeOppRow) });
  } catch (err) {
    console.error('GET /opps failed:', err);
    return res.status(500).json({ error: 'Failed to list opps' });
  }
});

// ---------------------------------------------------------------------------
// GET /opps/mine  -- current SE's Linear-derived + DB-saved opps
// ---------------------------------------------------------------------------
router.get('/mine', async (req, res) => {
  try {
    const prisma = await getPrisma();
    const salesEngineer = await prisma.salesEngineer.findUnique({
      where: { userId: req.user.id },
      include: { user: true },
    });

    const [fromLinear, saved] = await Promise.all([
      getMyOppNamesFromLinear(req.user.id),
      salesEngineer
        ? prisma.opp.findMany({
            where: { salesEngineerId: salesEngineer.id, archivedAt: null },
            orderBy: { updatedAt: 'desc' },
            include: { salesEngineer: { include: { user: true } } },
          })
        : Promise.resolve([]),
    ]);

    // De-dupe: if a Linear-derived group has the same opp name as a saved
    // row, prefer the saved one (it has a real id the SE can navigate to).
    const savedByName = new Map(saved.map((o) => [o.oppName.toLowerCase(), o]));
    const linearGroups = (fromLinear.groups || []).filter(
      (g) => !savedByName.has(g.oppName.toLowerCase()),
    );

    return res.json({
      hasSalesEngineer: !!salesEngineer,
      linear: {
        configured: !!fromLinear.configured,
        reason: fromLinear.reason || null,
        needsLinearProfile: fromLinear.needsLinearProfile || false,
        groups: linearGroups,
      },
      saved: saved.map(serializeOppRow),
    });
  } catch (err) {
    console.error('GET /opps/mine failed:', err);
    return res.status(500).json({ error: 'Failed to load my opps' });
  }
});

// ---------------------------------------------------------------------------
// POST /opps  -- create new Opp
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const prisma = await getPrisma();
    const oppName = (req.body?.oppName || '').trim();
    if (!oppName) {
      return res.status(400).json({ error: 'oppName is required' });
    }

    // Resolve owning SE: defaults to the caller, but a Lead/admin can pass
    // an explicit salesEngineerId to create on behalf.
    const roles = req.user?.roles || [];
    const callerIsPrivileged = roles.includes('admin') || roles.includes('sales_engineer_lead');
    let salesEngineerId = req.body?.salesEngineerId || null;
    if (salesEngineerId && !callerIsPrivileged) {
      return res.status(403).json({
        error: 'Only Leads or admins can create an Opp on behalf of another SE.',
      });
    }
    if (!salesEngineerId) {
      const ownSE = await prisma.salesEngineer.findUnique({
        where: { userId: req.user.id },
      });
      if (!ownSE) {
        return res.status(403).json({
          error: 'You need a Sales Engineer profile to create an Opp.',
        });
      }
      salesEngineerId = ownSE.id;
    }

    const sfId = req.body?.salesforceOpportunityId || null;
    const include = { salesEngineer: { include: { user: true } } };

    // Idempotent create-or-return. We resolve an existing row in priority
    // order so the same underlying opportunity never splits into two Hunt
    // Board entries -- which is exactly what happened when a Closed-Won deal
    // showed up in the New Hunt search under a renamed (or duplicate) SF
    // record:
    //
    //   1. By Salesforce opportunity id (most reliable). A rename in SF, or
    //      two SF records sharing a name, both collapse back to the one row
    //      that's already linked to this SF id.
    //   2. By (SE, oppName) -- the legacy key, still used for manual /
    //      Linear-derived opps that have no SF link yet. When we now have an
    //      SF id we backfill it so future id-based lookups match.
    if (sfId) {
      const bySfId = await prisma.opp.findFirst({
        where: { salesEngineerId, salesforceOpportunityId: sfId },
        include,
      });
      if (bySfId) {
        // Keep the display name in sync if SF renamed the opp -- but only
        // when the new name won't collide with another of this SE's rows
        // (the (SE, oppName) unique constraint). Otherwise leave it as-is.
        if (oppName && oppName !== bySfId.oppName) {
          const collision = await prisma.opp.findUnique({
            where: { salesEngineerId_oppName: { salesEngineerId, oppName } },
          });
          if (!collision) {
            const renamed = await prisma.opp.update({
              where: { id: bySfId.id },
              data: { oppName },
              include,
            });
            return res.status(200).json({ opp: serializeOpp(renamed, req.user) });
          }
        }
        return res.status(200).json({ opp: serializeOpp(bySfId, req.user) });
      }
    }

    const existing = await prisma.opp.findUnique({
      where: { salesEngineerId_oppName: { salesEngineerId, oppName } },
      include,
    });
    if (existing) {
      // Backfill the SF link onto a previously-unlinked row (manual or
      // Linear-derived) so the next id-based lookup consolidates instead of
      // creating a duplicate.
      if (sfId && !existing.salesforceOpportunityId) {
        const linked = await prisma.opp.update({
          where: { id: existing.id },
          data: { salesforceOpportunityId: sfId },
          include,
        });
        return res.status(200).json({ opp: serializeOpp(linked, req.user) });
      }
      return res.status(200).json({ opp: serializeOpp(existing, req.user) });
    }

    const created = await prisma.opp.create({
      data: {
        salesEngineerId,
        oppName,
        salesforceOpportunityId: sfId,
        customSectionsJson: JSON.stringify(DEFAULT_CUSTOM_SECTIONS),
      },
      include,
    });
    return res.status(201).json({ opp: serializeOpp(created, req.user) });
  } catch (err) {
    console.error('POST /opps failed:', err);
    return res.status(500).json({ error: 'Failed to create opp' });
  }
});

// ---------------------------------------------------------------------------
// GET /opps/linear/my-tickets  -- picker list for manual linking
//
// Returns the caller's currently-open Linear tickets so the "Link a ticket"
// modal can render a clickable list instead of forcing the SE to paste an
// identifier. Mounted before the dynamic /:id route below so "linear"
// doesn't get caught as an opp id.
// ---------------------------------------------------------------------------
router.get('/linear/my-tickets', async (req, res) => {
  try {
    const result = await listMyOpenLinearTickets(req.user.id);
    return res.json(result);
  } catch (err) {
    console.error('GET /opps/linear/my-tickets failed:', err);
    return res.status(500).json({ error: 'Failed to load Linear tickets' });
  }
});

// ---------------------------------------------------------------------------
// GET /opps/:id  -- full hydrate: row + linked Linear tickets
// SF + Gong data is loaded by the frontend via the existing /salesforce
// endpoints so we don't duplicate that surface here.
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const prisma = await getPrisma();
    const opp = await prisma.opp.findUnique({
      where: { id: req.params.id },
      include: { salesEngineer: { include: { user: true } } },
    });
    if (!opp) {
      return res.status(404).json({ error: 'Opp not found' });
    }

    // Auto-discover tickets by opp name, then merge in any manually-linked
    // identifiers (typed in by SEs when the AE didn't follow naming
    // conventions). The merge step flags manual entries so the UI can
    // surface an unlink button for them.
    const manualLinks = parseJson(opp.manualLinearLinksJson, []);
    const manualIdentifiers = Array.isArray(manualLinks)
      ? manualLinks.map((l) => (typeof l === 'string' ? l : l?.identifier)).filter(Boolean)
      : [];
    const baseTickets = await findLinearTicketsForOpp(opp.oppName);
    const linearTickets = await mergeManualLinearLinks(baseTickets, manualIdentifiers);

    return res.json({
      opp: serializeOpp(opp, req.user),
      linearTickets,
    });
  } catch (err) {
    console.error('GET /opps/:id failed:', err);
    return res.status(500).json({ error: 'Failed to load opp' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /opps/:id  -- update SE-authored fields (gated)
// ---------------------------------------------------------------------------
router.patch('/:id', requireOppEdit, async (req, res) => {
  try {
    const prisma = await getPrisma();
    const body = req.body || {};
    const data = {};

    // Allowlist: only these fields can be patched. Anything else (id,
    // salesEngineerId, oppName, timestamps) is intentionally read-only via
    // this endpoint so a careless client can't reassign ownership.
    const stringFields = [
      'aeNameOverride',
      'csmName',
      'qaLeadName',
      'qaManagerName',
      'qawTeam',
      'notesMarkdown',
    ];
    for (const key of stringFields) {
      if (key in body) {
        const value = body[key];
        data[key] = value === null || value === '' ? null : String(value);
      }
    }
    // SF stage snapshot. The FE sends this from the detail page whenever
    // the SF hydrate succeeds. We accept any non-empty string and stamp
    // stageSyncedAt server-side so the directory can show a "synced N
    // mins ago" tooltip if we ever want one. Stage = null clears the
    // snapshot (e.g. after a SF unlink).
    if ('currentStage' in body) {
      const next = body.currentStage;
      if (next === null || next === '') {
        data.currentStage = null;
        data.stageSyncedAt = null;
      } else {
        data.currentStage = String(next);
        data.stageSyncedAt = new Date();
      }
    }
    if ('technicalSpecs' in body) {
      data.technicalSpecsJson = body.technicalSpecs ? JSON.stringify(body.technicalSpecs) : null;
    }
    if ('customSections' in body) {
      data.customSectionsJson = Array.isArray(body.customSections)
        ? JSON.stringify(body.customSections)
        : null;
    }
    if ('creation' in body) {
      data.creationJson = body.creation ? JSON.stringify(body.creation) : null;
    }
    if ('estimation' in body) {
      data.estimationJson = body.estimation ? JSON.stringify(body.estimation) : null;
    }
    if ('salesforceOpportunityId' in body) {
      data.salesforceOpportunityId = body.salesforceOpportunityId || null;
    }

    // Reassign owning SE -- admins/Leads only. SEs can edit the content of
    // a hand they own, but can't transfer ownership to themselves or anyone
    // else. requireOppEdit has already verified the caller has SOME edit
    // right; we re-check the privileged role here for this specific field.
    if ('salesEngineerId' in body) {
      const roles = req.user?.roles || [];
      const callerIsPrivileged = roles.includes('admin') || roles.includes('sales_engineer_lead');
      if (!callerIsPrivileged) {
        return res.status(403).json({
          error: 'Only Leads or admins can reassign an Opp to a different SE.',
        });
      }
      const targetId = String(body.salesEngineerId || '').trim();
      if (!targetId) {
        return res.status(400).json({ error: 'salesEngineerId cannot be empty' });
      }
      const target = await prisma.salesEngineer.findUnique({ where: { id: targetId } });
      if (!target) {
        return res.status(404).json({ error: 'Target Sales Engineer not found' });
      }
      data.salesEngineerId = targetId;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }

    try {
      const updated = await prisma.opp.update({
        where: { id: req.params.id },
        data,
        include: { salesEngineer: { include: { user: true } } },
      });
      return res.json({ opp: serializeOpp(updated, req.user) });
    } catch (writeErr) {
      // Prisma unique-constraint violation: the target SE already owns an
      // Opp with this name. Surface a friendly 409 so the picker can show
      // a useful message instead of a generic 500.
      if (writeErr?.code === 'P2002') {
        return res.status(409).json({
          error: 'That Sales Engineer already has an Opp with this name.',
        });
      }
      throw writeErr;
    }
  } catch (err) {
    console.error('PATCH /opps/:id failed:', err);
    return res.status(500).json({ error: 'Failed to update opp' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /opps/:id  -- hard delete (gated)
//
// Tighter gate than the rest of the edit endpoints: only the owning SE or
// an admin can fully remove an Opp. Leads can edit-on-behalf but can't
// destroy other people's hands -- that's an owner/admin-only action.
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const prisma = await getPrisma();
    const opp = await prisma.opp.findUnique({
      where: { id: req.params.id },
      include: { salesEngineer: true },
    });
    if (!opp) {
      return res.status(404).json({ error: 'Opp not found' });
    }
    const roles = req.user?.roles || [];
    const isAdmin = roles.includes('admin');
    const isOwner = opp.salesEngineer?.userId === req.user.id;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        error: 'Only the owning Sales Engineer or an admin can delete this Opp.',
      });
    }
    // Best-effort: trash the linked Notion handoff page so deleting the
    // Opp doesn't leave an orphaned page in the Notion DB. A Notion
    // failure must never block the local delete, so we swallow errors and
    // surface them in the response for visibility.
    let notion = { attempted: false };
    if (opp.notionPageId && isNotionConfigured()) {
      notion = { attempted: true };
      try {
        const result = await archiveNotionOppPage(opp.notionPageId);
        notion.archived = !!result?.ok;
        if (!result?.ok) notion.reason = result?.reason;
      } catch (notionErr) {
        console.error('DELETE /opps/:id: Notion archive failed:', notionErr);
        notion.archived = false;
        notion.reason = 'error';
      }
    }

    await prisma.opp.delete({ where: { id: req.params.id } });
    return res.json({ success: true, notion });
  } catch (err) {
    console.error('DELETE /opps/:id failed:', err);
    return res.status(500).json({ error: 'Failed to delete opp' });
  }
});

// ---------------------------------------------------------------------------
// POST /opps/:id/linear-links  -- manually link a Linear ticket
//
// Accepts either a bare identifier ("AXO-959") or a full Linear URL in
// `{ identifier }` and validates the ticket exists in the configured team
// before persisting. Stored as `{ identifier, addedAt, addedByUserId }` so
// we can show provenance later ("Linked by Sebastian on Mar 5") without a
// follow-up query.
// ---------------------------------------------------------------------------
router.post('/:id/linear-links', requireOppEdit, async (req, res) => {
  try {
    const parsed = parseLinearIdentifier(req.body?.identifier);
    if (!parsed) {
      return res.status(400).json({
        error: 'Provide a Linear ticket identifier (e.g. AXO-959) or URL.',
      });
    }

    // Validate against Linear so a typo doesn't get persisted as a dead
    // link. A 404 here is a user-facing problem, not a 500.
    const lookup = await getLinearTicketByIdentifier(parsed.identifier);
    if (lookup.status === 'not_configured') {
      return res.status(503).json({
        error:
          "Linear isn't configured on the server. Ask an admin to set LINEAR_API_KEY / LINEAR_TEAM_ID.",
      });
    }
    if (lookup.status === 'not_found') {
      return res.status(404).json({
        error: `No Linear ticket ${parsed.identifier} found in the configured team.`,
      });
    }
    if (lookup.status !== 'ok') {
      return res.status(502).json({
        error: lookup.message || 'Linear lookup failed.',
      });
    }

    const prisma = await getPrisma();
    const existing = parseJson(req.opp.manualLinearLinksJson, []);
    const existingIds = new Set(
      existing
        .map((l) => (typeof l === 'string' ? l : l?.identifier))
        .filter(Boolean)
        .map((id) => id.toUpperCase()),
    );
    if (existingIds.has(parsed.identifier)) {
      // Idempotent: a re-link of the same ticket is a no-op, not an error.
      return res.json({ ok: true, identifier: parsed.identifier, alreadyLinked: true });
    }

    const next = [
      ...existing,
      {
        identifier: parsed.identifier,
        addedAt: new Date().toISOString(),
        addedByUserId: req.user.id,
      },
    ];
    await prisma.opp.update({
      where: { id: req.params.id },
      data: { manualLinearLinksJson: JSON.stringify(next) },
    });
    return res.status(201).json({
      ok: true,
      identifier: parsed.identifier,
      ticket: lookup.ticket,
    });
  } catch (err) {
    console.error('POST /opps/:id/linear-links failed:', err);
    return res.status(500).json({ error: 'Failed to link Linear ticket' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /opps/:id/linear-links/:identifier  -- unlink a manual link
//
// Only removes the manual entry; if the same ticket is also auto-detected
// by name it'll still appear on the page (just without the "manual" badge).
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// POST /opps/:id/notion  -- push handoff page to Notion (manual, SE-initiated)
//
// The FE passes the already-loaded `sfData` and `gongConversations` so we
// don't duplicate SOQL on the backend -- this keeps the route independent
// of Salesforce uptime and ensures the page we send is the page the SE
// just saw. The Opp's editor gate (requireOppEdit) applies as usual.
//
// Returns the freshly-serialized Opp so the FE can flip the button from
// "Send to Notion" -> "Open in Notion" without a follow-up GET.
// ---------------------------------------------------------------------------
router.post('/:id/notion', requireOppEdit, async (req, res) => {
  if (!isNotionConfigured()) {
    return res.status(501).json({
      error:
        'Notion is not configured on the server. Set NOTION_API_KEY and NOTION_HUNT_BOARD_DATABASE_ID.',
    });
  }
  try {
    const prisma = await getPrisma();
    const opp = await prisma.opp.findUnique({
      where: { id: req.params.id },
      include: { salesEngineer: { include: { user: true } } },
    });
    if (!opp) {
      return res.status(404).json({ error: 'Opp not found' });
    }

    const sf = req.body?.sfData || null;
    const gongCalls = Array.isArray(req.body?.gongConversations) ? req.body.gongConversations : [];
    // FE forwards the linked Linear-ticket bundle so the Notion handoff
    // can surface AE-template metadata (Slack thread on the Creation /
    // Scope tickets, "Type of Ask" hint) without another Linear API call.
    const linearTickets =
      req.body?.linearTickets && typeof req.body.linearTickets === 'object'
        ? req.body.linearTickets
        : null;

    const ownerSeName = opp.salesEngineer?.user
      ? `${opp.salesEngineer.user.firstName || ''} ${opp.salesEngineer.user.lastName || ''}`.trim() ||
        opp.salesEngineer.user.email ||
        ''
      : '';
    // Pass the SE email along too so notionService can fall back to an
    // email match when the display name in QAW Toolkit doesn't exactly
    // line up with Notion's record (different middle name, married name,
    // etc.). Notion's "Read user information including email addresses"
    // capability must be enabled on the integration for this to work.
    const ownerSeEmail = opp.salesEngineer?.user?.email || '';

    // Hydrate the Opp into the shape notionService expects (same field
    // names as serializeOpp -- parsing the JSON blobs once here keeps
    // notionService DB-agnostic).
    const hydrated = {
      oppName: opp.oppName,
      aeNameOverride: opp.aeNameOverride,
      csmName: opp.csmName,
      qaLeadName: opp.qaLeadName,
      qaManagerName: opp.qaManagerName,
      qawTeam: opp.qawTeam || null,
      notesMarkdown: opp.notesMarkdown || '',
      technicalSpecs: parseJson(opp.technicalSpecsJson, {}),
      customSections: parseJson(opp.customSectionsJson, []),
      creation: parseJson(opp.creationJson, { demoWorkspaceUrl: '', flows: [] }),
      estimation: parseJson(opp.estimationJson, {
        type: null,
        ratioDocUrl: '',
        exploratoryNotes: '',
        spreadsheetUrl: '',
      }),
    };

    const pagePayload = {
      opp: hydrated,
      sf,
      gongCalls,
      linearTickets,
      ownerSeName,
      ownerSeEmail,
    };

    let page;
    let action = 'created';
    try {
      // If we've already created a page for this Opp, re-sync it in place so
      // the SE can keep editing the handoff as the deal progresses rather
      // than spawning a new page each time. If that page was deleted in
      // Notion (404), fall back to creating a fresh one.
      if (opp.notionPageId) {
        try {
          page = await updateNotionOppPage({ pageId: opp.notionPageId, ...pagePayload });
          action = 'updated';
        } catch (err) {
          if (err?.status === 404) {
            console.warn(
              `Notion page ${opp.notionPageId} not found on update -- creating a fresh page.`,
            );
            page = await createNotionOppPage(pagePayload);
            action = 'recreated';
          } else {
            throw err;
          }
        }
      } else {
        page = await createNotionOppPage(pagePayload);
      }
    } catch (err) {
      console.error('Notion page sync failed:', err);
      // Notion 401 -> the token is bad or the integration was removed.
      // Notion 404 -> the database id is wrong or the integration isn't
      // connected to it. Bubble a user-actionable message either way.
      const status = err?.status || 502;
      const message =
        status === 401
          ? 'Notion rejected the API key. Verify NOTION_API_KEY and that the integration is enabled.'
          : status === 404
            ? 'Notion could not find the target database. Verify NOTION_HUNT_BOARD_DATABASE_ID and that the integration is connected to it.'
            : err?.message || 'Notion page sync failed.';
      return res.status(status === 401 || status === 404 ? status : 502).json({ error: message });
    }

    const updated = await prisma.opp.update({
      where: { id: req.params.id },
      data: {
        notionPageId: page.id,
        notionPageUrl: page.url,
        notionSyncedAt: new Date(),
      },
      include: { salesEngineer: { include: { user: true } } },
    });
    return res.json({ opp: serializeOpp(updated, req.user), action });
  } catch (err) {
    console.error('POST /opps/:id/notion failed:', err);
    return res.status(500).json({ error: 'Failed to send to Notion' });
  }
});

// ---------------------------------------------------------------------------
// POST /opps/:id/analyze-gong  -- Claude-powered handoff suggestions
//
// Reads the Gong AI call briefs the FE already loaded for this opp and asks
// Claude to extract Integrations / Pain Points / Additional Notes. Returns
// suggestions only -- the SE reviews and chooses what to insert client-side,
// so we never overwrite SE-authored content from here.
// ---------------------------------------------------------------------------
const ANALYZE_GONG_SYSTEM_PROMPT = `You are helping a Sales Engineer hand off a closed deal to a Lead.

You will be given the AI-generated briefs from a set of Gong sales calls for one opportunity. Read them and extract three things to seed the handoff doc:

1. integrations: third-party tools, systems, platforms, or services that are part of the product under test or that came up as relevant to QA (e.g. Stripe, Salesforce, Twilio, an internal API, a specific SSO provider). 
2. painPoints: the concrete problems, frustrations, or risks driving this evaluation -- what's broken or hard for the prospect today.
3. additionalNotes: anything else a Lead should know before owning this account -- a rocky or drawn-out sales cycle, the deal going stale and reviving, key stakeholders and their concerns, competitive pressure, timeline sensitivities, or other important call-outs.

Rules:
- Base everything strictly on the provided briefs. Do NOT speculate or invent details.
- If a category has no support in the briefs, return an empty string for it.
- Write each value as concise markdown bullet points (use "- " prefixes). Keep it scannable.
- Respond with ONLY a JSON object, no prose, no code fences, in exactly this shape:
{"integrations": "", "painPoints": "", "additionalNotes": ""}`;

function stripJsonFences(text) {
  if (typeof text !== 'string') return '';
  // Claude sometimes wraps JSON in ```json ... ``` despite instructions.
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

router.post('/:id/analyze-gong', requireOppEdit, async (req, res) => {
  if (!anthropicService.isConfigured()) {
    return res.status(501).json({
      error: 'Claude is not configured on the server. Set ANTHROPIC_API_KEY.',
    });
  }
  try {
    const conversations = Array.isArray(req.body?.gongConversations)
      ? req.body.gongConversations
      : [];
    const withBriefs = conversations.filter(
      (c) => typeof c?.summary === 'string' && c.summary.trim().length > 0,
    );
    if (withBriefs.length === 0) {
      return res.json({ suggestions: null, reason: 'no_summaries' });
    }

    // Compact, labeled context so Claude can attribute insights per call.
    const userPrompt = withBriefs
      .map((c, i) => {
        const title = c.title || c.name || `Call ${i + 1}`;
        const date = c.createdDate ? ` (${c.createdDate})` : '';
        return `## ${title}${date}\n${String(c.summary).trim()}`;
      })
      .join('\n\n');

    let raw;
    try {
      raw = await anthropicService.callAnthropic(ANALYZE_GONG_SYSTEM_PROMPT, userPrompt, {
        maxTokens: 1500,
      });
    } catch (err) {
      console.error('analyze-gong: Claude call failed:', err);
      return res.status(502).json({ error: 'Claude request failed. Try again.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(stripJsonFences(raw));
    } catch (err) {
      console.error('analyze-gong: could not parse Claude JSON:', err, raw);
      return res.status(502).json({ error: 'Claude returned an unexpected response. Try again.' });
    }

    const suggestions = {
      integrations: typeof parsed?.integrations === 'string' ? parsed.integrations.trim() : '',
      painPoints: typeof parsed?.painPoints === 'string' ? parsed.painPoints.trim() : '',
      additionalNotes:
        typeof parsed?.additionalNotes === 'string' ? parsed.additionalNotes.trim() : '',
    };

    return res.json({ suggestions, callsAnalyzed: withBriefs.length });
  } catch (err) {
    console.error('POST /opps/:id/analyze-gong failed:', err);
    return res.status(500).json({ error: 'Failed to analyze Gong calls' });
  }
});

router.delete('/:id/linear-links/:identifier', requireOppEdit, async (req, res) => {
  try {
    const target = String(req.params.identifier || '').toUpperCase();
    if (!target) {
      return res.status(400).json({ error: 'Identifier required' });
    }
    const prisma = await getPrisma();
    const existing = parseJson(req.opp.manualLinearLinksJson, []);
    const next = (Array.isArray(existing) ? existing : []).filter((l) => {
      const id = (typeof l === 'string' ? l : l?.identifier) || '';
      return id.toUpperCase() !== target;
    });
    await prisma.opp.update({
      where: { id: req.params.id },
      data: { manualLinearLinksJson: next.length ? JSON.stringify(next) : null },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /opps/:id/linear-links/:identifier failed:', err);
    return res.status(500).json({ error: 'Failed to unlink Linear ticket' });
  }
});

export default router;
