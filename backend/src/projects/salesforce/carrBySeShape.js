/**
 * Column resolution and row parsing for the "All Closed Won" report
 * (every closed-won opportunity in QA Wolf's history, grouped down by
 * fiscal year).
 *
 * Deliberately separate from reportShape.js: that file resolves the *metrics*
 * report, whose columns are a different set in a different order. Sharing one
 * resolver across both would mean one set of patterns that has to match two
 * layouts, which is exactly how a pattern gets loosened until it matches the
 * wrong cell.
 *
 * The layout at time of writing:
 *   [0] Owner Role  [1] Opportunity Owner  [2] Account Name
 *   [3] Opportunity Name  [4] Stage  [5] Fiscal Period  [6] Close Date
 *   [7] Type  [8] CARR (Opportunity.ARR__c)
 *
 * We resolve by name and, unlike the metrics report, do NOT fall back to those
 * positions. There is no historical layout to reproduce here, and a positional
 * guess on a report someone can freely reorder in Salesforce would silently
 * attribute the wrong CARR to an SE. A resolution failure raises instead.
 */

/** Logical column -> patterns tried against the SF column label, then its API name. */
const COLUMN_MATCHERS = {
  ownerRole: [/^owner\s*role$/i, /ROLLUP_DESCRIPTION/i],
  ownerName: [/^opportunity\s*owner$/i, /^owner$/i, /FULL_NAME/i],
  accountName: [/^account\s*name$/i, /ACCOUNT_NAME/i],
  opportunityName: [/^opportunity\s*name$/i, /^opportunity$/i, /OPPORTUNITY_NAME/i],
  stage: [/^stage(\s*name)?$/i, /STAGE_NAME/i],
  fiscalPeriod: [/^fiscal\s*(period|quarter)$/i, /FISCAL_QUARTER/i],
  closeDate: [/^close\s*date$/i, /CLOSE_DATE/i],
  type: [/^type$/i, /opportunity\s*type/i, /(^|\.)TYPE$/i],
  carr: [/^carr$/i, /(^|[^a-z])carr([^a-z]|$)/i, /ARR__c/i],
};

/**
 * Columns we refuse to run without. Owner role, stage and type are extra
 * context for the table; the four below are what the attribution and the
 * totals are actually built from.
 */
const REQUIRED_COLUMNS = ['ownerName', 'opportunityName', 'fiscalPeriod', 'carr'];

/**
 * The report's detail columns in order, with both API name and display label.
 * @param {object} reportResult raw jsforce analytics report result
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
 * Resolve every column index for the All Closed Won report.
 *
 * @throws {Error} with `code: 'REPORT_SHAPE'` when a required column can't be
 *   resolved by name, or when two required columns resolve to the same cell.
 *   Both mean the report was edited in a way we can't safely read; failing
 *   loudly beats attributing the wrong number to someone.
 */
export function resolveCarrBySeColumns(reportResult) {
  const columns = readDetailColumns(reportResult);
  if (!columns) {
    const error = new Error(
      'The All Closed Won report returned no column metadata, so its columns cannot be resolved by name.',
    );
    error.code = 'REPORT_SHAPE';
    throw error;
  }

  const resolved = {};
  for (const [key, matchers] of Object.entries(COLUMN_MATCHERS)) {
    resolved[key] = matchColumn(columns, matchers);
  }

  const missing = REQUIRED_COLUMNS.filter((key) => resolved[key] < 0);
  if (missing.length) {
    const error = new Error(
      `The All Closed Won report is missing required column(s): ${missing.join(', ')}. ` +
        `Columns present: ${columns.map((c) => c.label || c.apiName).join(', ')}.`,
    );
    error.code = 'REPORT_SHAPE';
    throw error;
  }

  const used = REQUIRED_COLUMNS.map((key) => resolved[key]);
  if (new Set(used).size !== used.length) {
    const error = new Error(
      'Two required columns in the All Closed Won report resolved to the same cell, so the column patterns are ambiguous for this layout.',
    );
    error.code = 'REPORT_SHAPE';
    throw error;
  }

  return resolved;
}

/**
 * Fiscal-year label for a factMap key, read off the report's own groupings
 * rather than the key's ordinal, so a report re-sorted descending still
 * labels its rows correctly.
 *
 * @returns {string} e.g. "2023", or '' for the grand-total bucket
 */
export function fiscalYearForKey(factMapKey, groupingsDown) {
  if (!factMapKey || factMapKey === 'T!T') return '';
  const groupKey = String(factMapKey).split('!')[0];
  const hit = (groupingsDown?.groupings || []).find((g) => String(g.key) === groupKey);
  return hit ? String(hit.label) : '';
}

/**
 * Parse one detail row into the shape the CARR-by-SE table renders.
 *
 * `opportunityId` is the Salesforce Opportunity Id carried in the name cell's
 * `value`, and it is the key every attribution is stored against -- a row
 * without one can't be attributed, so callers drop it rather than falling back
 * to the name (two opps can share a name; ids don't collide).
 *
 * @param {object[]} dataCells row.dataCells
 * @param {ReturnType<typeof resolveCarrBySeColumns>} cols
 * @param {string} fiscalYear
 */
export function parseCarrBySeRow(dataCells, cols, fiscalYear) {
  const cell = (index) => (index >= 0 ? dataCells[index] : undefined);
  const label = (index) => cell(index)?.label || '';

  return {
    opportunityId: cell(cols.opportunityName)?.value || '',
    opportunityName: label(cols.opportunityName),
    accountName: label(cols.accountName),
    ownerName: label(cols.ownerName),
    ownerId: cell(cols.ownerName)?.value || '',
    ownerRole: label(cols.ownerRole),
    stage: label(cols.stage),
    fiscalPeriod: label(cols.fiscalPeriod),
    fiscalYear,
    closeDate: cell(cols.closeDate)?.value || label(cols.closeDate),
    type: label(cols.type),
    carrAmount: cell(cols.carr)?.value?.amount || 0,
    carrAmountFormatted: label(cols.carr),
  };
}
