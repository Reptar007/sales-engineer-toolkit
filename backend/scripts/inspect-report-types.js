/**
 * Show how every Opportunity Type value in the metrics report is classified.
 *
 * Why this exists: the patterns in `goalComposition.js` are a best guess at the
 * Salesforce Type picklist. A value we fail to recognise is excluded from
 * goal-eligible CARR, and the "Q1/Q2 must not move" check does NOT catch that
 * for Expansion -- Expansion is supposed to be excluded from those quarters
 * anyway, so a misclassified Expansion value looks identical to a correctly
 * excluded one until Q3 quietly comes in low.
 *
 * Usage (from repo root):
 *   node backend/scripts/inspect-report-types.js 2026
 *
 * Requires .env with Salesforce credentials and a metrics report ID for the year.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSalesforceConnection } from '../src/projects/salesforce/functions.js';
import { resolveMetricsColumns } from '../src/projects/salesforce/reportShape.js';
import {
  normalizeOppType,
  isKnownOppType,
  goalEligibleTypesFor,
} from '../src/projects/salesforce/goalComposition.js';
import { getSalesforceConfig } from '../src/config/salesforce.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config();

const year = Number.parseInt(process.argv[2] || `${new Date().getFullYear()}`, 10);
if (Number.isNaN(year)) {
  console.error('Usage: node backend/scripts/inspect-report-types.js <year>');
  process.exit(1);
}

const reportId = getSalesforceConfig().reportIdsByYear?.[year]?.metrics;
if (!reportId) {
  console.error(`No metrics report configured for ${year}.`);
  process.exit(1);
}

const conn = await getSalesforceConnection();
const result = await conn.analytics.report(reportId).execute({ details: true });
const cols = resolveMetricsColumns(result);

console.log(`\nReport ${reportId}  (${year})`);
console.log(`Columns resolved from: ${cols.source}`);

if (cols.type < 0) {
  console.log('\n  NO TYPE COLUMN FOUND.');
  console.log('  Add Opportunity Type as the LAST column of the report, then re-run.');
  console.log('  Until then every row counts as goal-eligible and nothing splits.\n');
  process.exit(0);
}

console.log(`Type column index: ${cols.type}\n`);

// Tally raw values and their CARR, so a misclassification shows its cost.
const tally = new Map();
for (const quarter of Object.values(result.factMap || {})) {
  for (const row of quarter?.rows || []) {
    const raw = row.dataCells?.[cols.type]?.label || '(blank)';
    const carr = row.dataCells?.[cols.carr]?.value?.amount || 0;
    const entry = tally.get(raw) || { count: 0, carr: 0 };
    entry.count += 1;
    entry.carr += carr;
    tally.set(raw, entry);
  }
}

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const rows = [...tally.entries()].sort((a, b) => b[1].carr - a[1].carr);

console.log('RAW VALUE                        ROWS         CARR  ->  CLASSIFIED AS');
console.log('-'.repeat(78));
const problems = [];
for (const [raw, { count, carr }] of rows) {
  const normalized = raw === '(blank)' ? '' : normalizeOppType(raw);
  const known = normalized === '' || isKnownOppType(normalized);
  const shown = normalized === '' ? 'no type -> always counts' : normalized;
  console.log(
    `${raw.padEnd(30).slice(0, 30)}  ${String(count).padStart(5)}  ${usd(carr).padStart(12)}  ->  ${shown}${known ? '' : '   <-- UNRECOGNISED'}`,
  );
  if (!known) problems.push({ raw, carr });
}

console.log('-'.repeat(78));
console.log(`\nCounting rules by quarter:`);
for (const quarter of [1, 2, 3, 4]) {
  console.log(`  Q${quarter} CY${year}: ${goalEligibleTypesFor({ year, quarter }).join(' + ')}`);
}

if (problems.length) {
  const lost = problems.reduce((sum, p) => sum + p.carr, 0);
  console.log(`\n  ${problems.length} UNRECOGNISED VALUE(S), ${usd(lost)} of CARR affected:`);
  for (const p of problems) console.log(`    - "${p.raw}"`);
  console.log('\n  These are excluded from goal-eligible CARR in every quarter.');
  console.log('  If any of them should count, add a pattern to TYPE_PATTERNS in');
  console.log('  backend/src/projects/salesforce/goalComposition.js and re-run.\n');
  process.exit(1);
}

console.log('\n  Every Type value is recognised. Nothing is being silently dropped.\n');
