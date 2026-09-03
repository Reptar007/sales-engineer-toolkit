/**
 * Per-SE Closed CARR roll-up for the lead's "Pack" view.
 *
 * Salesforce has no SE field on an opportunity, so we attribute a deal's
 * CARR through its Account Executive: each opportunity carries an AE
 * (Salesforce id + name), every AccountExecutive belongs to a Team, and
 * each Team has exactly one Sales Engineer. So `opp.AE -> AE.team -> SE`.
 * We match the AE by Salesforce id first (exact) and fall back to a
 * normalized name match (covers AEs seeded without a real SF id). We pull
 * the year's metrics (snapshot or live), which arrive with goal policy
 * already applied, and sum each goal-eligible deal onto the owning SE --
 * split by opportunity type so the Pack view can show which stream each SE's
 * number came from.
 */
import { getPrisma } from '../lib/prisma.js';
import { getMetricsQuarterlyDataForYear } from '../projects/salesforce/metricsForYear.js';
import { typeBucket } from '../projects/salesforce/goalEligibility.js';

function normalizeName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/**
 * @param {number} year calendar year for the CARR window
 * @returns {Promise<{
 *   configured: boolean,
 *   year: number,
 *   sets: Array<{ seId, userId, name, byQuarter: Record<string, number>,
 *                 byType: Record<string, number>,
 *                 byQuarterType: Record<string, Record<string, number>>,
 *                 total: number }>,
 * }>}
 */
export async function getPackCarr(year) {
  const prisma = await getPrisma();
  const ses = await prisma.salesEngineer.findMany({
    where: { isActive: true },
    include: { user: true },
    orderBy: { id: 'asc' },
  });

  // Seed a record per SE, plus a teamId -> seId lookup (one SE per team).
  const bySe = new Map();
  const teamToSe = new Map();
  for (const se of ses) {
    const fullName = `${se.user?.firstName || ''} ${se.user?.lastName || ''}`.trim();
    bySe.set(se.id, {
      seId: se.id,
      userId: se.userId,
      name: fullName || se.user?.email || 'Unknown SE',
      byQuarter: {},
      // New Business / Expansion split, overall and per quarter, so a lead can
      // see which stream an SE's CARR came from rather than one lumped figure.
      byType: {},
      byQuarterType: {},
      total: 0,
    });
    if (se.teamId) teamToSe.set(se.teamId, se.id);
  }

  // Resolve each AE to the SE of their team. Include inactive AEs so
  // historical deals still attribute. Index by both Salesforce id and
  // normalized name for matching against the report.
  const aes = await prisma.accountExecutive.findMany({
    select: { name: true, salesforceId: true, teamId: true },
  });
  const aeSfIdToSe = new Map();
  const aeNameToSe = new Map();
  for (const ae of aes) {
    const seId = teamToSe.get(ae.teamId);
    if (!seId) continue;
    if (ae.salesforceId) aeSfIdToSe.set(ae.salesforceId, seId);
    if (ae.name) aeNameToSe.set(normalizeName(ae.name), seId);
  }

  let quarterly = null;
  try {
    quarterly = await getMetricsQuarterlyDataForYear(year);
  } catch (err) {
    console.error('pack-carr: metrics load failed -', err.message);
  }

  if (!quarterly) {
    return { configured: false, year, sets: Array.from(bySe.values()) };
  }

  for (const [quarterName, q] of Object.entries(quarterly)) {
    if (quarterName === 'Total') continue;
    for (const opp of q.opportunities || []) {
      // `goalEligible` is decided upstream in goalEligibility.js -- C-score
      // exclusions, leadership exceptions, and whether the opportunity's type
      // counts toward the goal in this particular quarter. Re-deriving any of
      // that here is what let this roll-up drift from the dashboard before.
      if (!opp.goalEligible) continue;
      // AE Salesforce id first (exact), then fall back to AE name.
      const seId =
        (opp.aeId && aeSfIdToSe.get(opp.aeId)) || aeNameToSe.get(normalizeName(opp.aeName));
      if (!seId) continue;
      const rec = bySe.get(seId);
      const amount = opp.carrAmount || 0;
      const bucket = typeBucket(opp);
      rec.byQuarter[quarterName] = (rec.byQuarter[quarterName] || 0) + amount;
      rec.byType[bucket] = (rec.byType[bucket] || 0) + amount;
      rec.byQuarterType[quarterName] = rec.byQuarterType[quarterName] || {};
      rec.byQuarterType[quarterName][bucket] =
        (rec.byQuarterType[quarterName][bucket] || 0) + amount;
      rec.total += amount;
    }
  }

  return { configured: true, year, sets: Array.from(bySe.values()) };
}
