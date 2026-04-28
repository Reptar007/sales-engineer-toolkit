/**
 * Helpers for attaching SE-scoped metrics (`quarterlyDataForUser`) to the
 * existing pack-wide salesforce metrics payloads.
 *
 * Used by:
 *   - GET /api/salesforce/report/:reportId  (live Salesforce metrics)
 *   - GET /api/salesforce/snapshot/:year    (saved snapshot of the same)
 *
 * Design notes:
 *   - We intentionally never mutate the pack-wide aggregation. Admins,
 *     SE leads, and any user without a team continue to see the original
 *     `quarterlyData` exactly as before.
 *   - When the request is from an SE who has at least one assigned AE, we
 *     re-reduce `quarterlyData[*].opportunities` filtered by `aeName`
 *     (case-insensitive, whitespace-trimmed) against the SE's own AE list
 *     and attach the result as a parallel `quarterlyDataForUser`.
 *   - Each per-quarter entry preserves the original shape so the frontend
 *     can swap fields in/out with no transform: `{ quarter, totalCARR,
 *     totalCARRFormatted, opportunityCount, opportunities }`.
 */

import { getPrisma } from '../../lib/prisma.js';

function normalize(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function formatUSD(amount) {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Look up the AE names assigned to the requesting user's SE record.
 * Returns `null` when the user has no SE record (e.g. admin without a team)
 * or when the SE has no active AEs — both cases mean "don't filter".
 */
export async function loadAssignedAENames(userId) {
  if (!userId) return null;
  const prisma = await getPrisma();
  const se = await prisma.salesEngineer.findUnique({
    where: { userId },
    select: {
      team: {
        select: {
          accountExecutives: {
            where: { isActive: true },
            select: { name: true },
          },
        },
      },
    },
  });
  const names = se?.team?.accountExecutives?.map((ae) => ae.name) ?? [];
  return names.length > 0 ? names : null;
}

/**
 * Re-reduce a pack-wide metrics payload's `quarterlyData` against an AE
 * allow-list and attach the result as `quarterlyDataForUser`. No-op when
 * `assignedAENames` is null/empty so admins keep their pack view.
 *
 * Returns the same payload object (mutated in place for ergonomics; the
 * caller is responsible for not sharing payload objects across requests).
 */
export function withQuarterlyDataForUser(payload, assignedAENames) {
  if (!payload || !payload.quarterlyData) return payload;
  if (!assignedAENames || assignedAENames.length === 0) return payload;

  const allowed = new Set(assignedAENames.map(normalize));
  const filteredQuarterly = {};
  let yearlyTotalCARR = 0;
  let yearlyOppCount = 0;

  for (const [quarterName, quarterEntry] of Object.entries(payload.quarterlyData)) {
    if (quarterName === 'Total') continue;
    const opps = Array.isArray(quarterEntry.opportunities) ? quarterEntry.opportunities : [];
    const filteredOpps = opps.filter((opp) => allowed.has(normalize(opp.aeName)));
    const totalCARR = filteredOpps.reduce((sum, opp) => sum + (opp.carrAmount || 0), 0);
    filteredQuarterly[quarterName] = {
      quarter: quarterName,
      totalCARR,
      totalCARRFormatted: formatUSD(totalCARR),
      opportunityCount: filteredOpps.length,
      opportunities: filteredOpps,
    };
    yearlyTotalCARR += totalCARR;
    yearlyOppCount += filteredOpps.length;
  }

  filteredQuarterly['Total'] = {
    quarter: 'Total',
    totalCARR: yearlyTotalCARR,
    totalCARRFormatted: formatUSD(yearlyTotalCARR),
    opportunityCount: yearlyOppCount,
    // Mirrors the pack-wide payload, which leaves Total.opportunities
    // empty since the per-quarter buckets already carry the line items.
    opportunities: [],
  };

  payload.quarterlyDataForUser = filteredQuarterly;
  payload.userAECount = assignedAENames.length;
  return payload;
}
