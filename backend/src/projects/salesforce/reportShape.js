// Column resolution for the metrics report.
//
// Historically this guessed column positions from row width, because the 2026
// report inserted an "Account Score" column between "Sales Score" and
// "Effective Date" and shifted everything after it:
//
//   2025 (6 cols):
//     [0] AE  [1] Opp  [2] Sales Score  [3] Effective Date  [4] Gross ARR  [5] CARR
//   2026 (7 cols):
//     [0] AE  [1] Opp  [2] Sales Score  [3] Account Score  [4] Effective Date
//     [5] Gross ARR  [6] CARR
//
// Width-guessing is why adding a column is dangerous here: an *inserted*
// column shifts CARR by one and silently corrupts every number on the
// dashboard rather than raising an error. So we now prefer resolving columns
// by name against the Analytics API's own metadata, and only fall back to the
// positional map when that resolution is incomplete.
//
// The fallback is all-or-nothing on purpose. A partial name match mixed with
// positional guesses is the one combination that could quietly read the wrong
// cell, so either every required column resolves by name or we use exactly the
// behaviour that shipped before.

/** Logical column -> patterns tried against the SF column label, then its API name. */
const COLUMN_MATCHERS = {
  aeName: [/^ae(\s|$)/i, /account\s*executive/i, /opportunity\s*owner/i, /^owner/i],
  opportunityName: [/^opportunity\s*name$/i, /^opportunity$/i, /OPPORTUNITY_NAME/i],
  salesScore: [/^sales\s*score$/i],
  accountScore: [/^account\s*score$/i],
  effectiveDate: [/^effective\s*date$/i, /^close\s*date$/i, /CLOSE_DATE/i],
  grossARR: [/gross\s*arr/i, /Gross_ARR__c/i],
  carr: [/^carr$/i, /(^|[^a-z])carr([^a-z]|$)/i],
  type: [/^type$/i, /opportunity\s*type/i, /(^|\.)TYPE$/i],
};

// Type is optional -- it only exists once it has been added to the report.
// Account Score is optional because the 2025 layout predates it.
const REQUIRED_COLUMNS = [
  'aeName',
  'opportunityName',
  'salesScore',
  'effectiveDate',
  'grossARR',
  'carr',
];

// Returns true when the metrics report includes the Account Score column.
// Probes the first non-empty row's cell count -- every row in a given report
// shares the same layout, so one row is enough. Falls back to false (old
// shape) when the report has no rows at all, so an empty year doesn't promote
// itself to the new layout and start parsing absent fields.
export function detectHasAccountScore(factMap) {
  for (const quarter of Object.values(factMap || {})) {
    const cells = quarter?.rows?.[0]?.dataCells;
    if (cells?.length) return cells.length >= 7;
  }
  return false;
}

// The positional map, kept as the fallback and as the reference for what the
// two historical layouts look like.
export function getMetricsColumnIndices(hasAccountScore) {
  return {
    aeName: 0,
    opportunityName: 1,
    salesScore: 2,
    accountScore: hasAccountScore ? 3 : -1,
    effectiveDate: hasAccountScore ? 4 : 3,
    grossARR: hasAccountScore ? 5 : 4,
    carr: hasAccountScore ? 6 : 5,
  };
}

/** Widest row in the report, used only by the positional Type fallback. */
function firstRowWidth(factMap) {
  for (const quarter of Object.values(factMap || {})) {
    const cells = quarter?.rows?.[0]?.dataCells;
    if (cells?.length) return cells.length;
  }
  return 0;
}

/**
 * The report's detail columns in order, with both API name and display label.
 * Returns null when the result carries no column metadata -- notably snapshot
 * payloads, which only persist factMap-derived rows.
 */
export function readDetailColumns(reportResult) {
  const apiNames = reportResult?.reportMetadata?.detailColumns;
  if (!Array.isArray(apiNames) || apiNames.length === 0) return null;
  const info = reportResult?.reportExtendedMetadata?.detailColumnInfo || {};
  return apiNames.map((apiName, index) => ({
    index,
    apiName,
    label: info[apiName]?.label || '',
    dataType: info[apiName]?.dataType || '',
  }));
}

function matchColumn(columns, matchers) {
  for (const matcher of matchers) {
    const hit = columns.find(
      (column) => matcher.test(column.label || '') || matcher.test(column.apiName || ''),
    );
    if (hit) return hit.index;
  }
  return -1;
}

/**
 * Best-effort Type index when name resolution didn't fully succeed.
 *
 * Prefers a name match even in the fallback path, since finding Type by name
 * can't corrupt the six columns the positional map already covers. Failing
 * that, assumes Type was *appended* after CARR -- which is the documented way
 * to add it, precisely because appending leaves indices 0..carr untouched.
 */
function fallbackTypeIndex(reportResult, positional) {
  const columns = readDetailColumns(reportResult);
  if (columns) {
    const byName = matchColumn(columns, COLUMN_MATCHERS.type);
    if (byName >= 0) return byName;
  }
  const appendedIndex = positional.carr + 1;
  return firstRowWidth(reportResult?.factMap) > appendedIndex ? appendedIndex : -1;
}

/**
 * Resolve every column index for a metrics report result.
 *
 * @param {object} reportResult raw jsforce analytics report result
 * @returns {{ aeName:number, opportunityName:number, salesScore:number,
 *   accountScore:number, effectiveDate:number, grossARR:number, carr:number,
 *   type:number, source:'metadata'|'positional' }}
 */
export function resolveMetricsColumns(reportResult) {
  const columns = readDetailColumns(reportResult);

  if (columns) {
    const resolved = {};
    for (const [key, matchers] of Object.entries(COLUMN_MATCHERS)) {
      resolved[key] = matchColumn(columns, matchers);
    }
    const complete = REQUIRED_COLUMNS.every((key) => resolved[key] >= 0);
    // Distinct indices only; two logical columns resolving to the same cell
    // means the patterns are ambiguous for this report, so don't trust them.
    const used = REQUIRED_COLUMNS.map((key) => resolved[key]);
    const distinct = new Set(used).size === used.length;
    if (complete && distinct) {
      return { ...resolved, source: 'metadata' };
    }
  }

  const positional = getMetricsColumnIndices(detectHasAccountScore(reportResult?.factMap));
  return {
    ...positional,
    type: fallbackTypeIndex(reportResult, positional),
    source: 'positional',
  };
}

/**
 * Parse one report row into the shared opportunity shape. Single definition so
 * the live route, the snapshot writer and the server-side metrics loader can't
 * drift in what they read out of a cell.
 *
 * @param {object[]} dataCells row.dataCells
 * @param {ReturnType<typeof resolveMetricsColumns>} cols
 * @param {string} quarterName
 */
export function parseMetricsRow(dataCells, cols, quarterName) {
  const cell = (index) => (index >= 0 ? dataCells[index] : undefined);
  const label = (index) => cell(index)?.label || '';

  return {
    aeName: label(cols.aeName),
    aeId: cell(cols.aeName)?.value || '',
    opportunityName: label(cols.opportunityName),
    opportunityId: cell(cols.opportunityName)?.value || '',
    salesScore: label(cols.salesScore),
    // '' on the 2025 layout, which has no Account Score column.
    accountScore: label(cols.accountScore),
    // '' until Opportunity Type is added to the report; goalComposition.js
    // treats an empty type as goal-eligible so historical years don't move.
    type: label(cols.type),
    effectiveDate: label(cols.effectiveDate),
    grossARRAmount: cell(cols.grossARR)?.value?.amount || 0,
    grossARRAmountFormatted: label(cols.grossARR),
    carrAmount: cell(cols.carr)?.value?.amount || 0,
    carrAmountFormatted: label(cols.carr),
    quarter: quarterName,
  };
}
