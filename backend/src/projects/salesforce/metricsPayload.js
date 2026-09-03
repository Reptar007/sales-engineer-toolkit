/**
 * Applies goal policy to a metrics payload at *read* time.
 *
 * Snapshots on disk and live report fetches both hold raw closed-won rows.
 * Policy (C-score exclusions, goal exceptions, which opportunity types count
 * in which quarter) is applied here instead of being baked into the stored
 * data, so a policy change never requires re-snapshotting a finalised year.
 *
 * The per-quarter contract every consumer can rely on afterwards:
 *   opportunities      every row, each tagged { type, goalEligible }
 *   totalCARR          goal-eligible rows only  (unchanged semantics)
 *   opportunityCount   goal-eligible rows only  (unchanged semantics)
 *   carrByType         goal-eligible CARR split by type; sums to totalCARR
 *   countByType        goal-eligible row counts by type
 *   composition        { id, label, types } in force for the quarter
 *   excludedCount      rows dropped by policy
 *   unrecognizedTypes  Type values we couldn't classify
 */
import { parseQuarterKey } from './quarterKey.js';
import { tagOpportunities, summarizeQuarter } from './goalEligibility.js';
import { compositionFor, normalizeOppType, UNSPECIFIED_BUCKET } from './goalComposition.js';

function usd(amount) {
  return `$${Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Decorate one quarter entry. `quarterName` is the report's own label, which
 * is where the year and quarter number come from.
 */
export function decorateMetricsQuarter(quarterEntry, quarterName) {
  const period = parseQuarterKey(quarterName);
  const opportunities = tagOpportunities(quarterEntry?.opportunities, period);
  const summary = summarizeQuarter(opportunities, period);

  return {
    ...quarterEntry,
    quarter: quarterName,
    opportunities,
    totalCARR: summary.totalCARR,
    totalCARRFormatted: usd(summary.totalCARR),
    opportunityCount: summary.eligibleCount,
    eligibleCount: summary.eligibleCount,
    excludedCount: summary.excludedCount,
    carrByType: summary.carrByType,
    countByType: summary.countByType,
    composition: summary.composition,
    unrecognizedTypes: summary.unrecognizedTypes,
  };
}

/**
 * Decorate a whole metrics payload in place and return it. Safe to call on a
 * payload that has already been decorated (idempotent) and on legacy snapshot
 * payloads whose rows carry no `type` at all.
 *
 * @param {{ quarterlyData?: object, allOpportunities?: object[] }} payload
 */
export function decorateMetricsPayload(payload) {
  if (!payload?.quarterlyData) return payload;

  const decorated = {};
  let yearlyTotalCARR = 0;
  let yearlyCount = 0;
  const yearlyCarrByType = {};
  const compositionIds = new Set();
  const unrecognized = new Set();

  for (const [quarterName, entry] of Object.entries(payload.quarterlyData)) {
    if (quarterName === 'Total') continue;
    const quarter = decorateMetricsQuarter(entry, quarterName);
    decorated[quarterName] = quarter;

    yearlyTotalCARR += quarter.totalCARR;
    yearlyCount += quarter.opportunityCount;
    for (const [bucket, amount] of Object.entries(quarter.carrByType)) {
      yearlyCarrByType[bucket] = (yearlyCarrByType[bucket] || 0) + amount;
    }
    compositionIds.add(quarter.composition.id);
    for (const value of quarter.unrecognizedTypes) unrecognized.add(value);
  }

  decorated.Total = {
    quarter: 'Total',
    totalCARR: yearlyTotalCARR,
    totalCARRFormatted: usd(yearlyTotalCARR),
    opportunityCount: yearlyCount,
    carrByType: yearlyCarrByType,
    // The year now spans more than one composition, so a single yearly figure
    // sums two different definitions of "counts toward goal". Flagged rather
    // than hidden so the UI can asterisk it.
    mixedComposition: compositionIds.size > 1,
    // Total is a roll-up; per-quarter buckets carry the line items.
    opportunities: [],
  };

  payload.quarterlyData = decorated;

  // `allOpportunities` powers `totalOpportunities` and any flat consumer. Each
  // row already knows its own quarter, so tag against that.
  if (Array.isArray(payload.allOpportunities)) {
    payload.allOpportunities = payload.allOpportunities.flatMap((opp) =>
      tagOpportunities([opp], parseQuarterKey(opp?.quarter)),
    );
  }

  payload.unrecognizedTypes = [...unrecognized];
  payload.mixedComposition = compositionIds.size > 1;

  if (unrecognized.size > 0) {
    console.warn(
      `metrics: unrecognised Opportunity Type value(s) [${[...unrecognized].join(', ')}] -- ` +
        'these are excluded from goal-eligible CARR. Add a pattern in goalComposition.js.',
    );
  }

  return payload;
}

/** Composition rule for a quarter label, re-exported for route-level use. */
export function compositionForQuarterKey(quarterName) {
  return compositionFor(parseQuarterKey(quarterName));
}

/**
 * Apply the same read-time treatment to a *calculator* payload.
 *
 * The calculator report is open pipeline, not closed-won, so no goal-eligibility
 * policy applies -- an opp either closes this quarter or it doesn't, and the SE
 * decides which ones to project. All this does is canonicalise `type` (so
 * "upsell" and "Existing Business - Expansion" render as one thing) and total
 * the pipeline per stream, so the calculator can show which stream a projection
 * is leaning on now that both count toward one goal.
 *
 * @param {{ data?: object[] }} payload
 */
export function decorateCalculatorPayload(payload) {
  if (!payload?.data || !Array.isArray(payload.data)) return payload;

  const carrByType = {};
  const countByType = {};

  payload.data = payload.data.map((opp) => {
    const type = normalizeOppType(opp?.type);
    const bucket = type === '' ? UNSPECIFIED_BUCKET : type;
    const amount = opp?.carrAmount || 0;
    carrByType[bucket] = (carrByType[bucket] || 0) + amount;
    countByType[bucket] = (countByType[bucket] || 0) + 1;
    return { ...opp, type };
  });

  payload.carrByType = carrByType;
  payload.countByType = countByType;
  return payload;
}
