/**
 * One-off script: generate a PDF breakdown of a quarter's Closed-Won CARR.
 *
 * Thin CLI wrapper around `src/services/quarterCarrPdfService.js` so the file
 * on disk is identical to what the Alpha Pack → Quarterly Goals tab downloads.
 *
 * Usage (from repo root):
 *   node backend/scripts/generate-quarter-carr-pdf.js [quarter] [year]
 * Examples:
 *   node backend/scripts/generate-quarter-carr-pdf.js 2 2026
 *   node backend/scripts/generate-quarter-carr-pdf.js 2        # current year
 *
 * Data is pulled from a snapshot when available, otherwise live from the
 * configured Salesforce metrics report. Requires .env with Salesforce
 * credentials / report IDs and a reachable database for goals.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, createWriteStream } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

const { getQuarterCarrReport, streamQuarterCarrPdf, getReportFilename } = await import(
  '../src/services/quarterCarrPdfService.js'
);

const quarterArg = process.argv[2];
const yearArg = process.argv[3];
const quarterNum = quarterArg ? parseInt(quarterArg, 10) : 2;
const year = yearArg ? parseInt(yearArg, 10) : new Date().getFullYear();

if (Number.isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
  console.error('Quarter must be 1-4. Usage: node generate-quarter-carr-pdf.js <quarter> <year>');
  process.exit(1);
}
if (Number.isNaN(year)) {
  console.error('Invalid year. Usage: node generate-quarter-carr-pdf.js <quarter> <year>');
  process.exit(1);
}

function usd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function main() {
  const report = await getQuarterCarrReport(year, quarterNum);

  console.log(`\nQ${quarterNum} ${year} (${report.quarterKey})`);
  console.log(`  Closed-won (goal-eligible): ${report.opps.length} opps`);
  console.log(`  Total CARR: ${usd(report.totalCARR)}`);
  console.log(`  Goal:       ${usd(report.goal)}`);
  console.log(
    `  Attainment: ${report.pct == null ? 'N/A (no goal set)' : report.pct.toFixed(2) + '%'}`,
  );
  if (report.excludedCount > 0) console.log(`  (Excluded ${report.excludedCount} C-scored opp(s))`);

  const outDir = resolve(__dirname, '../../reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, getReportFilename(report));

  await streamQuarterCarrPdf(createWriteStream(outPath), report);
  console.log(`\nPDF written to: ${outPath}\n`);
}

main().catch((err) => {
  console.error('Failed to generate report:', err.message);
  console.error(err.stack);
  process.exit(1);
});
