import { writeFileSync, mkdirSync } from 'fs';
import {
  getSalesforceConnection,
  getQuarterName,
  addYearToSnapshotRegistry,
  SNAPSHOTS_DIR,
} from './functions.js';
import { resolveMetricsColumns, parseMetricsRow } from './reportShape.js';
import { getSalesforceConfig } from '../../config/salesforce.js';

function usd(amount) {
  return `$${Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Create snapshot JSON files for a given year by fetching both reports from
 * Salesforce and writing them to backend/data/snapshots/. Also updates the
 * snapshot registry.
 *
 * Snapshots store RAW closed-won rows -- no C-score filtering, no opportunity
 * type filtering. Goal policy is applied when a snapshot is read (see
 * metricsPayload.js), so a later policy change never requires re-snapshotting
 * a finalised year. The `totalCARR` written here is therefore the unfiltered
 * sum and is not what any surface displays.
 *
 * @param {number} year - Year to snapshot (e.g. 2025, 2026).
 * @returns {Promise<{ success: true, message: string }>}
 * @throws {Error} If config is missing for year, or Salesforce fetch fails.
 */
export async function createSnapshotForYear(year) {
  const config = getSalesforceConfig();
  const reportIds = config.reportIdsByYear?.[year];
  if (!reportIds?.metrics || !reportIds?.calculator) {
    throw new Error(
      `No report config for year ${year}. Set SALESFORCE_REPORT_ID_METRICS_${year} and ensure calculator ID is set.`,
    );
  }

  const conn = await getSalesforceConnection();
  const metricsReportId = reportIds.metrics;
  const calculatorReportId = reportIds.calculator;

  const [metricsResult, calculatorResult] = await Promise.all([
    conn.analytics.report(metricsReportId).execute({ details: true }),
    conn.analytics.report(calculatorReportId).execute({ details: true }),
  ]);

  // Column indices resolve from the report's own metadata where available and
  // fall back to the positional map. Snapshots written before Opportunity Type
  // was added to the report simply carry `type: ''` on every row, which reads
  // back as goal-eligible so historical years don't move.
  const cols = resolveMetricsColumns(metricsResult);
  const quarterlyData = {};
  const allOpportunities = [];

  for (const quarterKey of Object.keys(metricsResult.factMap || {})) {
    const quarterData = metricsResult.factMap[quarterKey];
    const quarterName = getQuarterName(quarterKey, metricsResult.groupingsDown);
    if (quarterName === 'Total') continue;

    const opportunities = Array.isArray(quarterData?.rows)
      ? quarterData.rows.map((row) => parseMetricsRow(row.dataCells, cols, quarterName))
      : [];
    allOpportunities.push(...opportunities);

    const rawTotalCARR = opportunities.reduce((sum, opp) => sum + opp.carrAmount, 0);
    quarterlyData[quarterName] = {
      quarter: quarterName,
      totalCARR: rawTotalCARR,
      totalCARRFormatted: usd(rawTotalCARR),
      opportunityCount: opportunities.length,
      opportunities,
    };
  }

  const yearlyTotalCARR = Object.values(quarterlyData).reduce(
    (sum, quarter) => sum + (quarter.totalCARR || 0),
    0,
  );
  quarterlyData['Total'] = {
    quarter: 'Total',
    totalCARR: yearlyTotalCARR,
    totalCARRFormatted: usd(yearlyTotalCARR),
    opportunityCount: allOpportunities.length,
    opportunities: [],
  };

  const metricsPayload = {
    success: true,
    reportId: metricsReportId,
    // Recorded so a snapshot can be audited later for which layout produced
    // it, and whether Type was present at capture time.
    columnSource: cols.source,
    hasTypeColumn: cols.type >= 0,
    capturedAt: new Date().toISOString(),
    totalOpportunities: allOpportunities.length,
    quarterlyData,
    allOpportunities,
    filtered: false,
  };

  // Format calculator (same shape as GET /report/:reportId for calculator)
  const calcRows = calculatorResult.factMap?.['T!T']?.rows ?? [];
  const calcData = calcRows.map((row) => {
    const dataCells = row.dataCells;
    return {
      opportunityId: dataCells[0]?.value || '',
      opportunityName: dataCells[0]?.label || '',
      stage: dataCells[1]?.label || '',
      quarter: dataCells[2]?.label || '',
      type: dataCells[3]?.label || '',
      aeName: dataCells[4]?.label || '',
      probability: dataCells[5]?.value || '',
      probabilityFormatted: dataCells[5]?.label || '',
      carrAmount: dataCells[6]?.value?.amount || 0,
      amount: dataCells[6]?.label || '',
    };
  });
  const totalCARR = calcData.reduce((sum, opp) => sum + (opp.carrAmount || 0), 0);
  const calculatorPayload = {
    success: true,
    reportId: calculatorReportId,
    totalOpportunities: calcData.length,
    totalCARR,
    totalCARRFormatted: usd(totalCARR),
    data: calcData,
  };

  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  writeFileSync(
    `${SNAPSHOTS_DIR}/${year}-metrics.json`,
    JSON.stringify(metricsPayload, null, 2),
    'utf8',
  );
  writeFileSync(
    `${SNAPSHOTS_DIR}/${year}-calculator.json`,
    JSON.stringify(calculatorPayload, null, 2),
    'utf8',
  );
  addYearToSnapshotRegistry(year);

  return { success: true, message: `Snapshot created for ${year}` };
}
