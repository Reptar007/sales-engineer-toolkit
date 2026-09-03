/**
 * Server-side loader for a year's Salesforce metrics `quarterlyData`,
 * preferring a saved snapshot (no SF round-trip) and falling back to a live
 * report fetch. Returns the same per-quarter shape the HTTP routes emit, with
 * goal policy already applied -- each quarter carries an `opportunities` array
 * whose entries include `opportunityId`, `carrAmount`, `accountScore`, `type`
 * and `goalEligible`, plus the `carrByType` split.
 *
 * Extracted so non-HTTP consumers (the pack CARR roll-up, the quarterly CARR
 * PDF) can reuse the metrics without going back through the REST layer -- and
 * so they share one definition of what counts toward goal.
 */
import { readFileSync } from 'fs';
import {
  getSalesforceConnection,
  getQuarterName,
  readSnapshotRegistry,
  SNAPSHOTS_DIR,
} from './functions.js';
import { resolveMetricsColumns, parseMetricsRow } from './reportShape.js';
import { decorateMetricsQuarter } from './metricsPayload.js';
import { getSalesforceConfig } from '../../config/salesforce.js';

/**
 * Parse a raw jsforce metrics report result into per-quarter decorated data.
 * Column indices come from `resolveMetricsColumns`, which prefers the report's
 * own column metadata and only falls back to positional guessing.
 */
function buildQuarterlyData(metricsResult) {
  const cols = resolveMetricsColumns(metricsResult);
  const quarterlyData = {};

  for (const quarterKey of Object.keys(metricsResult.factMap || {})) {
    const quarterData = metricsResult.factMap[quarterKey];
    const quarterName = getQuarterName(quarterKey, metricsResult.groupingsDown);
    if (quarterName === 'Total') continue;

    const opportunities = Array.isArray(quarterData?.rows)
      ? quarterData.rows.map((row) => parseMetricsRow(row.dataCells, cols, quarterName))
      : [];

    quarterlyData[quarterName] = decorateMetricsQuarter({ opportunities }, quarterName);
  }
  return quarterlyData;
}

/** Apply policy to a snapshot's stored (raw) quarterlyData. */
function decorateStoredQuarterlyData(quarterlyData) {
  const out = {};
  for (const [quarterName, entry] of Object.entries(quarterlyData || {})) {
    if (quarterName === 'Total') continue;
    out[quarterName] = decorateMetricsQuarter(entry, quarterName);
  }
  return out;
}

/**
 * Resolve a year's metrics `quarterlyData`. Snapshot first, then live.
 * Returns null when the year is neither snapshotted nor configured with a
 * live report id (the caller treats that as "CARR unavailable").
 *
 * @param {number} year
 * @returns {Promise<Record<string, object> | null>}
 */
export async function getMetricsQuarterlyDataForYear(year) {
  const registry = readSnapshotRegistry();
  if (registry.years.includes(year)) {
    try {
      const raw = readFileSync(`${SNAPSHOTS_DIR}/${year}-metrics.json`, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.quarterlyData) return decorateStoredQuarterlyData(parsed.quarterlyData);
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
