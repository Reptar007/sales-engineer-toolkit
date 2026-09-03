/**
 * The single answer to "does this closed-won opportunity count toward the
 * quarterly goal?".
 *
 * Two independent axes:
 *   1. Account Score -- C-scored accounts are out, unless they carry an
 *      explicit leadership exception (see goalExceptions.js).
 *   2. Opportunity Type -- only the types the quarter's composition counts
 *      (see goalComposition.js).
 *
 * This question used to be answered at six call sites with rules that had
 * already drifted apart: the report route and the pack roll-up used an exact
 * `accountScore !== 'C'`, which let a `C-` score through that the PDF and the
 * Trophies page both excluded. Because the dashboard reads the server's
 * `totalCARR` while Trophies re-filtered client-side, the two pages could
 * print different CARR for the same quarter. Every consumer now imports from
 * here instead.
 */
import { isGoalException } from './goalExceptions.js';
import {
  countsTowardGoal,
  normalizeOppType,
  compositionFor,
  collectUnrecognizedTypes,
  OPP_TYPE_UNSPECIFIED,
  UNSPECIFIED_BUCKET,
} from './goalComposition.js';

/**
 * C-scored on the ICP-uplifted Account Score, and not explicitly excepted.
 * Handles the `C`, `C `, and `C-` forms -- the strictest of the six variants
 * that used to exist.
 */
export function isCScore(opp) {
  if (isGoalException(opp)) return false;
  const raw = (opp?.accountScore || '').trim().toUpperCase();
  return raw === 'C' || raw.startsWith('C ') || raw.startsWith('C-');
}

/**
 * @param {object} opp a parsed metrics row
 * @param {{year:number,quarter:number}|string} period the quarter it sits in
 * @returns {boolean}
 */
export function isGoalEligible(opp, period) {
  if (!opp) return false;
  if (isCScore(opp)) return false;
  return countsTowardGoal(opp, period);
}

/**
 * Copy `opportunities` with `type` canonicalised and `goalEligible` decided,
 * so nothing downstream re-derives either. Pure -- never mutates its input.
 *
 * @param {object[]} opportunities
 * @param {{year:number,quarter:number}|string} period
 */
export function tagOpportunities(opportunities, period) {
  if (!Array.isArray(opportunities)) return [];
  return opportunities.map((opp) => {
    const type = normalizeOppType(opp?.type);
    const tagged = { ...opp, type };
    tagged.goalEligible = isGoalEligible(tagged, period);
    return tagged;
  });
}

/** Bucket name a row's CARR is attributed to in per-type breakdowns. */
export function typeBucket(opp) {
  const type = normalizeOppType(opp?.type);
  return type === OPP_TYPE_UNSPECIFIED ? UNSPECIFIED_BUCKET : type;
}

/**
 * Roll a quarter's tagged rows into the totals every surface needs: the
 * goal-eligible headline, and the per-type split behind it.
 *
 * `carrByType` / `countByType` cover goal-eligible rows only, so the segments
 * always add up to the headline figure -- that reconciliation is the whole
 * point of showing a split at all.
 *
 * @param {object[]} taggedOpportunities output of tagOpportunities
 * @param {{year:number,quarter:number}|string} period
 */
export function summarizeQuarter(taggedOpportunities, period) {
  const rows = Array.isArray(taggedOpportunities) ? taggedOpportunities : [];
  const eligible = rows.filter((opp) => opp.goalEligible);

  const carrByType = {};
  const countByType = {};
  for (const opp of eligible) {
    const bucket = typeBucket(opp);
    carrByType[bucket] = (carrByType[bucket] || 0) + (opp.carrAmount || 0);
    countByType[bucket] = (countByType[bucket] || 0) + 1;
  }

  const totalCARR = eligible.reduce((sum, opp) => sum + (opp.carrAmount || 0), 0);
  const composition = compositionFor(period);

  return {
    totalCARR,
    eligibleCount: eligible.length,
    excludedCount: rows.length - eligible.length,
    carrByType,
    countByType,
    composition: { id: composition.id, label: composition.label, types: composition.types },
    unrecognizedTypes: collectUnrecognizedTypes(rows),
  };
}
