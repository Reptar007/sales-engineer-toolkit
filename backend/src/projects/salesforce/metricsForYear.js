/**
 * Server-side loader for a year's Salesforce metrics `quarterlyData`,
 * preferring a saved snapshot (no SF round-trip) and falling back to a
 * live report fetch. Returns the same per-quarter shape the HTTP routes
 * emit — each quarter carries an `opportunities` array whose entries
 * include `opportunityId`, `carrAmount`, and `accountScore`.
 *
 * Extracted so non-HTTP consumers (e.g. the pack CARR roll-up) can reuse
 * the metrics without going back through the REST layer.
 */
import { readFileSync } from 'fs';
import {
  getSalesforceConnection,
  getQuarterName,
  readSnapshotRegistry,
  SNAPSHOTS_DIR,
} from './functions.js';
import { detectHasAccountScore, getMetricsColumnIndices } from './reportShape.js';
import { getSalesforceConfig } from '../../config/salesforce.js';

// Parse a raw jsforce metrics report result into the lightweight
// per-quarter shape we need for CARR attribution. Mirrors the column
// handling in snapshotService / the /report route, but only keeps the
// fields the roll-up actually uses.
function buildQuarterlyData(metricsResult) {
  const hasAccountScore = detectHasAccountScore(metricsResult.factMap);
  const cols = getMetricsColumnIndices(hasAccountScore);
  const quarterlyData = {};

  for (const quarterKey of Object.keys(metricsResult.factMap || {})) {
    const quarterData = metricsResult.factMap[quarterKey];
    const quarterName = getQuarterName(quarterKey, metricsResult.groupingsDown);
    if (quarterName === 'Total') continue;

    const opportunities = [];
    if (Array.isArray(quarterData?.rows)) {
      for (const row of quarterData.rows) {
        const dataCells = row.dataCells;
        opportunities.push({
          opportunityId: dataCells[cols.opportunityName]?.value || '',
          opportunityName: dataCells[cols.opportunityName]?.label || '',
          aeName: dataCells[cols.aeName]?.label || '',
          aeId: dataCells[cols.aeName]?.value || '',
          accountScore: cols.accountScore >= 0 ? dataCells[cols.accountScore]?.label || '' : '',
          carrAmount: dataCells[cols.carr]?.value?.amount || 0,
          quarter: quarterName,
        });
      }
    }
    quarterlyData[quarterName] = { quarter: quarterName, opportunities };
  }
  return quarterlyData;
}

/**
 * Resolve a year's metrics `quarterlyData`. Snapshot first, then live.
 * Returns null when the year is neither snapshotted nor configured with a
 * live report id (the caller treats that as "CARR unavailable").
 *
 * @param {number} year
 * @returns {Promise<Record<string, { quarter: string, opportunities: object[] }> | null>}
 */
export async function getMetricsQuarterlyDataForYear(year) {
  const registry = readSnapshotRegistry();
  if (registry.years.includes(year)) {
    try {
      const raw = readFileSync(`${SNAPSHOTS_DIR}/${year}-metrics.json`, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.quarterlyData) return parsed.quarterlyData;
    } catch {
      // Fall through to a live fetch if the snapshot file is missing/corrupt.
    }
  }

  const config = getSalesforceConfig();
  const reportId = config.reportIdsByYear?.[year]?.metrics;
  if (!reportId) return null;

  const conn = await getSalesforceConnection();
  const metricsResult = await conn.analytics.report(reportId).execute({ details: true });
  return buildQuarterlyData(metricsResult);
}
