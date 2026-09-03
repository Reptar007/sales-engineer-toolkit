/**
 * Goal composition -- which opportunity types count toward the quarterly goal
 * in a given quarter.
 *
 * Company policy changed mid-CY2026: New Business and Expansion became a
 * single combined goal from Q3 CY2026 onward. Quarters before that cutover
 * stay New Business only, so already-reported numbers reproduce exactly even
 * though the underlying Salesforce report now returns Expansion rows for every
 * quarter.
 *
 * Nothing about the policy lives anywhere but the COMPOSITION_CUTOVERS table
 * below. Folding in another type later (say renewals from Q1 CY2027) is one
 * more entry here and no change anywhere else.
 */
import { parseQuarterKey } from './quarterKey.js';

export const OPP_TYPE_NEW_BUSINESS = 'New Business';
export const OPP_TYPE_EXPANSION = 'Expansion';
export const OPP_TYPE_RENEWAL = 'Renewal';

/** Sentinel for a row with no Type at all (2025 snapshots, pre-column reports). */
export const OPP_TYPE_UNSPECIFIED = '';

/** Label used for the "no type on the row" bucket in per-type breakdowns. */
export const UNSPECIFIED_BUCKET = 'Unspecified';

/**
 * Cutovers, newest first. `from` is inclusive -- the first entry whose `from`
 * is at or before the quarter being evaluated wins.
 */
export const COMPOSITION_CUTOVERS = [
  {
    id: 'nb-plus-expansion',
    from: { year: 2026, quarter: 3 },
    types: [OPP_TYPE_NEW_BUSINESS, OPP_TYPE_EXPANSION],
    label: 'New Business + Expansion',
  },
  {
    id: 'nb-only',
    from: { year: 0, quarter: 1 },
    types: [OPP_TYPE_NEW_BUSINESS],
    label: 'New Business',
  },
];

/**
 * Raw Salesforce Type picklist values, canonicalised.
 *
 * These patterns are a best guess until the live picklist is confirmed --
 * `GET /api/salesforce/report/:reportId/columns` dumps the real column
 * metadata, and `unrecognizedTypes` on every metrics payload reports any value
 * that matched nothing so it surfaces instead of quietly changing a total.
 */
const TYPE_PATTERNS = [
  { canonical: OPP_TYPE_EXPANSION, pattern: /expansion|upsell|up-sell|cross[\s-]?sell/i },
  { canonical: OPP_TYPE_NEW_BUSINESS, pattern: /new\s*(business|logo|customer)/i },
  { canonical: OPP_TYPE_RENEWAL, pattern: /renewal|renew/i },
];

export const KNOWN_OPP_TYPES = [OPP_TYPE_NEW_BUSINESS, OPP_TYPE_EXPANSION, OPP_TYPE_RENEWAL];

/**
 * Canonicalise a raw Type value. Unrecognised non-empty values are returned
 * as-is (never coerced into a known type) so they stay visible.
 * @param {unknown} raw
 * @returns {string} a canonical type, the original string, or '' when absent
 */
export function normalizeOppType(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return OPP_TYPE_UNSPECIFIED;
  const hit = TYPE_PATTERNS.find((entry) => entry.pattern.test(value));
  return hit ? hit.canonical : value;
}

export function isKnownOppType(type) {
  return KNOWN_OPP_TYPES.includes(type);
}

// Accept either a {year, quarter} pair or a raw report label, so callers can
// pass whichever they happen to be holding.
function toPeriod(period) {
  if (!period) return null;
  if (typeof period === 'string') return parseQuarterKey(period);
  const { year, quarter } = period;
  if (!Number.isInteger(year) || !Number.isInteger(quarter)) return null;
  return { year, quarter };
}

/**
 * The composition rule in force for a quarter.
 *
 * An unparseable quarter falls back to the *widest* composition rather than
 * the narrowest: if a label ever stops matching, the failure mode should be a
 * number that looks too high and gets questioned, not revenue silently
 * dropping out of the report.
 *
 * @param {{year:number,quarter:number}|string} period
 */
export function compositionFor(period) {
  const parsed = toPeriod(period);
  if (!parsed) return COMPOSITION_CUTOVERS[0];
  return (
    COMPOSITION_CUTOVERS.find(
      (cutover) =>
        parsed.year > cutover.from.year ||
        (parsed.year === cutover.from.year && parsed.quarter >= cutover.from.quarter),
    ) || COMPOSITION_CUTOVERS[COMPOSITION_CUTOVERS.length - 1]
  );
}

export function goalEligibleTypesFor(period) {
  return compositionFor(period).types;
}

export function compositionLabelFor(period) {
  return compositionFor(period).label;
}

/**
 * Does this opportunity's type count toward the goal in this quarter?
 *
 * A row with NO type counts. Every 2025 snapshot row and everything captured
 * before the Type column existed carries no type, and excluding those would
 * zero out history -- the same reason an empty `accountScore` is deliberately
 * treated as "not C" elsewhere in this pipeline.
 *
 * A row that DOES carry a type must match the quarter's composition. After the
 * cutover the goal is *defined* as New Business plus Expansion, so anything
 * else -- renewals, or a picklist value we don't recognise -- is out. That
 * cuts the other way from the empty case on purpose: an unexpected value
 * showing up as excluded will move a quarter total and get caught by the
 * "Q1/Q2 must not move" check, whereas silently including it would not.
 *
 * @param {{ type?: string }} opp
 * @param {{year:number,quarter:number}|string} period
 */
export function countsTowardGoal(opp, period) {
  const type = normalizeOppType(opp?.type);
  if (type === OPP_TYPE_UNSPECIFIED) return true;
  return goalEligibleTypesFor(period).includes(type);
}

/**
 * True when two quarters count the same set of types, so their totals are
 * directly comparable. Drives whether the UI is allowed to show a
 * quarter-over-quarter delta.
 */
export function sameComposition(a, b) {
  return compositionFor(a).id === compositionFor(b).id;
}

/**
 * Non-empty type values that matched none of the known patterns. Surfaced on
 * the payload so a picklist we guessed wrong about is visible rather than
 * inferred from a wrong total.
 */
export function collectUnrecognizedTypes(opportunities = []) {
  const found = new Set();
  for (const opp of opportunities) {
    const type = normalizeOppType(opp?.type);
    if (type !== OPP_TYPE_UNSPECIFIED && !isKnownOppType(type)) found.add(type);
  }
  return [...found];
}
