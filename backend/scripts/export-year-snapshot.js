/**
 * One-off script to create a snapshot for a given year (e.g. 2025).
 * Fetches metrics and calculator reports from Salesforce and writes JSON to backend/data/snapshots/.
 *
 * Usage (from repo root):
 *   node backend/scripts/export-year-snapshot.js 2025
 * Or from backend directory:
 *   node scripts/export-year-snapshot.js 2025
 *
 * Requires .env with Salesforce credentials and report IDs for the year.
 * After running, add the year to SNAPSHOT_YEARS in .env if not already present.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSnapshotForYear } from '../src/projects/salesforce/snapshotService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

const yearArg = process.argv[2];
const year = yearArg ? parseInt(yearArg, 10) : new Date().getFullYear();

if (Number.isNaN(year)) {
  console.error('Usage: node export-year-snapshot.js <year>');
  console.error('Example: node export-year-snapshot.js 2025');
  process.exit(1);
}

createSnapshotForYear(year)
  .then((result) => {
    console.log(result.message);
    console.log(
      `Files written to backend/data/snapshots/${year}-metrics.json and ${year}-calculator.json`,
    );
    console.log('Add', year, 'to SNAPSHOT_YEARS in .env if not already present.');
  })
  .catch((err) => {
    console.error('Failed to create snapshot:', err.message);
    process.exit(1);
  });
