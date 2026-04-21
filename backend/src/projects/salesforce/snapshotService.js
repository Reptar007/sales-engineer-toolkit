import { writeFileSync, mkdirSync } from 'fs';
import {
  getSalesforceConnection,
  getQuarterName,
  addYearToSnapshotRegistry,
  SNAPSHOTS_DIR,
} from './functions.js';
import { getSalesforceConfig } from '../../config/salesforce.js';

/**
 * Create snapshot JSON files for a given year by fetching both reports from Salesforce
 * and writing them to backend/data/snapshots/. Also updates the snapshot registry.
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

  // Format metrics (same shape as GET /report/:reportId for metrics)
  const quarterlyData = {};
  const allOpportunities = [];
  Object.keys(metricsResult.factMap).forEach((quarterKey) => {
    const quarterData = metricsResult.factMap[quarterKey];
    const quarterName = getQuarterName(quarterKey, metricsResult.groupingsDown);
    if (quarterName === 'Total') return;

    const opportunities = [];
    if (quarterData.rows && Array.isArray(quarterData.rows)) {
      quarterData.rows.forEach((row) => {
        const dataCells = row.dataCells;
        const aeId = dataCells[0]?.value || '';
        // AE, Opp, Sales Score, Effective Date, Gross ARR, CARR — same as GET /report/:reportId metrics branch.
        const opportunity = {
          aeName: dataCells[0]?.label || '',
          opportunityName: dataCells[1]?.label || '',
          salesScore: dataCells[2]?.label || '',
          effectiveDate: dataCells[3]?.label || '',
          grossARRAmount: dataCells[4]?.value?.amount || 0,
          grossARRAmountFormatted: dataCells[4]?.label || '',
          carrAmount: dataCells[5]?.value?.amount || 0,
          carrAmountFormatted: dataCells[5]?.label || '',
          aeId,
          opportunityId: dataCells[1]?.value || '',
          quarter: quarterName,
        };
        opportunities.push(opportunity);
        allOpportunities.push(opportunity);
      });
    }
    const filteredTotalCARR = opportunities.reduce((sum, opp) => sum + opp.carrAmount, 0);
    quarterlyData[quarterName] = {
      quarter: quarterName,
      totalCARR: filteredTotalCARR,
      totalCARRFormatted: `$${filteredTotalCARR.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
      opportunityCount: opportunities.length,
      opportunities,
    };
  });
  let yearlyTotalCARR = 0;
  Object.keys(quarterlyData).forEach((key) => {
    if (key !== 'Total') yearlyTotalCARR += quarterlyData[key].totalCARR || 0;
  });
  quarterlyData['Total'] = {
    quarter: 'Total',
    totalCARR: yearlyTotalCARR,
    totalCARRFormatted: `$${yearlyTotalCARR.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    opportunityCount: allOpportunities.length,
    opportunities: [],
  };
  const metricsPayload = {
    success: true,
    reportId: metricsReportId,
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
    totalCARRFormatted: `$${totalCARR.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
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
