/**
 * Loads the "All Closed Won" report and merges it with the manual SE credit
 * stored in `opp_carr_attributions`.
 *
 * Salesforce owns the opportunity facts (name, account, owner, fiscal period,
 * CARR) and the database owns exactly one thing: which SE gets credit. Nothing
 * about an opportunity is copied into our tables and then read back for a
 * total, so a corrected CARR in Salesforce shows up here on the next load
 * rather than needing a re-sync.
 *
 * Totals are deliberately NOT computed here. The picker updates a row the
 * instant it changes, so the client re-totals from the same `rows` array it is
 * rendering -- one derivation, which is what keeps the cards and the table
 * from ever disagreeing. See frontend .../carr-by-se/carrTotals.js.
 */
import { getSalesforceConnection } from './functions.js';
import { resolveCarrBySeColumns, parseCarrBySeRow, fiscalYearForKey } from './carrBySeShape.js';
import { getPrisma } from '../../lib/prisma.js';
import { getAllClosedWonReportId } from '../../config/salesforce.js';

/**
 * The report is ~400 rows of finalised history that changes only when a deal
 * closes, while the picker is used in long editing sessions. Caching the parsed
 * rows keeps every save from paying a Salesforce round-trip; `refresh` forces a
 * re-read when someone is looking for a deal that just closed.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let rowCache = null; // { at: number, rows: object[], reportName: string }

function connectionErrorFor(cause) {
  const error = new Error(
    `Failed to read the All Closed Won report from Salesforce: ${cause?.message || cause}`,
  );
  error.code = 'SF_REPORT';
  return error;
}

/**
 * Fetch and parse every detail row of the All Closed Won report.
 *
 * The Analytics API caps a synchronous run at 2000 detail rows, so we surface
 * the API's own `allData` flag rather than assuming the report fits. A silently
 * truncated report would show a total that is simply wrong, with nothing on
 * screen to say so.
 *
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<{ rows: object[], reportName: string, allData: boolean, fromCache: boolean }>}
 */
export async function fetchAllClosedWonRows({ refresh = false } = {}) {
  if (!refresh && rowCache && Date.now() - rowCache.at < CACHE_TTL_MS) {
    return { ...rowCache, fromCache: true };
  }

  const reportId = getAllClosedWonReportId();
  let result;
  try {
    const conn = await getSalesforceConnection();
    result = await conn.analytics.report(reportId).execute({ details: true });
  } catch (error) {
    throw connectionErrorFor(error);
  }

  const cols = resolveCarrBySeColumns(result);
  const groupingsDown = result.groupingsDown;
  const rows = [];

  for (const [factMapKey, bucket] of Object.entries(result.factMap || {})) {
    if (factMapKey === 'T!T') continue;
    const fiscalYear = fiscalYearForKey(factMapKey, groupingsDown);
    for (const row of bucket?.rows || []) {
      const parsed = parseCarrBySeRow(row.dataCells, cols, fiscalYear);
      // No Salesforce Id means there is nothing stable to attribute against.
      if (!parsed.opportunityId) continue;
      rows.push(parsed);
    }
  }

  rows.sort(
    (a, b) =>
      (b.closeDate || '').localeCompare(a.closeDate || '') ||
      a.opportunityName.localeCompare(b.opportunityName),
  );

  rowCache = {
    at: Date.now(),
    rows,
    reportName: result.attributes?.reportName || 'All Closed Won',
    allData: result.allData !== false,
  };
  return { ...rowCache, fromCache: false };
}

/** Drop the cached rows, so the next read goes back to Salesforce. */
export function invalidateAllClosedWonCache() {
  rowCache = null;
}

/** Active SEs, in the same display shape the Opp reassignment picker uses. */
export async function listActiveSalesEngineers() {
  const prisma = await getPrisma();
  const ses = await prisma.salesEngineer.findMany({
    where: { isActive: true },
    include: { user: true },
  });
  return ses
    .map((se) => ({
      id: se.id,
      userId: se.userId,
      firstName: se.user?.firstName || null,
      lastName: se.user?.lastName || null,
      email: se.user?.email || null,
      name:
        `${se.user?.firstName || ''} ${se.user?.lastName || ''}`.trim() || se.user?.email || se.id,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Map of salesforceOpportunityId -> salesEngineerId for every stored credit. */
export async function loadAttributionMap() {
  const prisma = await getPrisma();
  const rows = await prisma.oppCarrAttribution.findMany({
    select: { salesforceOpportunityId: true, salesEngineerId: true },
  });
  return new Map(rows.map((r) => [r.salesforceOpportunityId, r.salesEngineerId]));
}

/**
 * The whole page payload: every closed-won row tagged with its stored SE
 * credit (`salesEngineerId: null` when unattributed), the SE picker options,
 * and the fiscal years present in the report.
 *
 * A credit pointing at an SE who has since been deactivated is returned as
 * `null` rather than dropped, so the row shows as unattributed and can be
 * re-assigned instead of quietly holding CARR that no card accounts for.
 */
export async function getCarrBySePayload({ refresh = false } = {}) {
  const [{ rows, reportName, allData, fromCache }, salesEngineers, attributions] =
    await Promise.all([
      fetchAllClosedWonRows({ refresh }),
      listActiveSalesEngineers(),
      loadAttributionMap(),
    ]);

  const activeSeIds = new Set(salesEngineers.map((se) => se.id));
  const taggedRows = rows.map((row) => {
    const assigned = attributions.get(row.opportunityId) || null;
    return { ...row, salesEngineerId: assigned && activeSeIds.has(assigned) ? assigned : null };
  });

  const years = [...new Set(taggedRows.map((row) => row.fiscalYear).filter(Boolean))].sort((a, b) =>
    b.localeCompare(a),
  );

  return {
    reportId: getAllClosedWonReportId(),
    reportName,
    allData,
    fromCache,
    years,
    salesEngineers,
    rows: taggedRows,
  };
}

/**
 * Set or clear the SE credit for one opportunity.
 *
 * `salesEngineerId: null` deletes the row rather than storing a null, so
 * "None" is the absence of a record and an unattributed opp can never be
 * counted toward anyone.
 *
 * @param {string} opportunityId Salesforce Opportunity Id
 * @param {string|null} salesEngineerId
 * @param {{ userId?: string, oppName?: string }} context
 */
export async function setAttribution(opportunityId, salesEngineerId, context = {}) {
  const prisma = await getPrisma();

  if (!salesEngineerId) {
    await prisma.oppCarrAttribution.deleteMany({
      where: { salesforceOpportunityId: opportunityId },
    });
    return { opportunityId, salesEngineerId: null };
  }

  const se = await prisma.salesEngineer.findFirst({
    where: { id: salesEngineerId, isActive: true },
    select: { id: true },
  });
  if (!se) {
    const error = new Error('Unknown or inactive sales engineer.');
    error.code = 'UNKNOWN_SE';
    throw error;
  }

  await prisma.oppCarrAttribution.upsert({
    where: { salesforceOpportunityId: opportunityId },
    create: {
      salesforceOpportunityId: opportunityId,
      salesEngineerId,
      oppName: context.oppName || null,
      assignedByUserId: context.userId || null,
    },
    update: {
      salesEngineerId,
      oppName: context.oppName || undefined,
      assignedByUserId: context.userId || null,
    },
  });

  return { opportunityId, salesEngineerId };
}
