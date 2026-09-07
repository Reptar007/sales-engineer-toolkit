#!/usr/bin/env node
/**
 * Seed CARR-by-SE attributions from the SE handoff log.
 *
 * Reads backend/data/attributions/se-handoffs.csv, resolves each client name
 * against the live "All Closed Won" Salesforce report and each replier against
 * the SalesEngineer table, then writes the resulting credits.
 *
 * Run this instead of copying rows between environments. The attributions
 * table stores `salesEngineerId` cuids, which are generated per-database --
 * a dump from local SQLite would point at SEs that don't exist in production.
 * Re-deriving from the log is the only portable form.
 *
 * Dry run by default; pass --apply to write. Idempotent: re-running with no
 * changes to the CSV is a no-op.
 *
 *   node scripts/seed-carr-attributions.js              # show the plan
 *   node scripts/seed-carr-attributions.js --apply      # write it
 *
 * Against production the DATABASE_URL in the environment selects the database,
 * exactly as seed-all-teams.js does:
 *
 *   heroku run "cd backend && node scripts/seed-carr-attributions.js" --app qa-sales-engineering
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

const { getCarrBySePayload, setAttribution } = await import(
  '../src/projects/salesforce/carrBySeService.js'
);
const { parseCsv, resolveHandoffLog, planWrites } = await import(
  '../src/projects/salesforce/carrAttributionSeed.js'
);

const APPLY = process.argv.includes('--apply');
const CSV_PATH = resolve(__dirname, '../data/attributions/se-handoffs.csv');

const usd = (amount) => `$${Math.round(amount).toLocaleString('en-US')}`;

async function main() {
  const entries = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  console.log(`Read ${entries.length} handoff rows from ${CSV_PATH}\n`);

  const payload = await getCarrBySePayload({ refresh: true });
  if (payload.allData === false) {
    console.error(
      'REFUSING TO SEED: Salesforce truncated the All Closed Won report, so some ' +
        'opportunities are missing and their credits would be silently dropped.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Report "${payload.reportName}": ${payload.rows.length} opportunities, ` +
      `${payload.salesEngineers.length} active SEs\n`,
  );

  const { desired, ambiguous, missing, notSes } = resolveHandoffLog(
    entries,
    payload.rows,
    payload.salesEngineers,
  );
  const { adds, changes, removes, unchanged } = planWrites(desired, payload.rows);
  const nameById = new Map(payload.salesEngineers.map((se) => [se.id, se.name]));
  const label = (d) =>
    `${d.row.opportunityName.padEnd(38)} ${usd(d.row.carrAmount).padStart(11)}  ${d.row.fiscalPeriod}`;

  console.log(`NEW (${adds.length})`);
  for (const d of adds) console.log(`  + ${nameById.get(d.seId).padEnd(20)} ${label(d)}`);
  console.log(`\nREASSIGNED (${changes.length})`);
  for (const d of changes)
    console.log(`  ~ ${nameById.get(d.from)} -> ${nameById.get(d.seId)}: ${label(d)}`);
  console.log(`\nREVOKED to None (${removes.length})`);
  for (const d of removes) console.log(`  - was ${nameById.get(d.from).padEnd(16)} ${label(d)}`);
  console.log(`\nUnchanged: ${unchanged.length}`);

  if (notSes.length) {
    const byReplier = {};
    for (const n of notSes) (byReplier[n.replier] ||= []).push(n.client);
    console.log(`\nReplier is not an active SE, left unattributed (${notSes.length}):`);
    for (const [who, clients] of Object.entries(byReplier))
      console.log(`  ${who} (${clients.length}): ${clients.join(', ')}`);
  }
  if (ambiguous.length) {
    console.log(`\nAmbiguous client names, skipped (${ambiguous.length}):`);
    for (const a of ambiguous)
      console.log(
        `  "${a.client}" -> ${a.candidates.map((c) => `${c.opportunityName} (${c.fiscalPeriod})`).join(' | ')}`,
      );
  }
  if (missing.length) {
    console.log(`\nNo matching opportunity in the report (${missing.length}):`);
    for (const m of missing)
      console.log(`  ${m.client}${m.wanted ? `  [would have credited ${m.wanted}]` : ''}`);
  }

  const writes = [...adds, ...changes, ...removes];
  if (!APPLY) {
    console.log(`\nDRY RUN — ${writes.length} write(s) pending. Re-run with --apply to write.`);
    return;
  }

  for (const d of writes) {
    await setAttribution(d.row.opportunityId, d.seId, { oppName: d.row.opportunityName });
  }
  console.log(`\nApplied ${writes.length} write(s).`);

  const after = await getCarrBySePayload({ refresh: false });
  const tally = {};
  let total = 0;
  for (const row of after.rows) {
    if (!row.salesEngineerId) continue;
    const who = nameById.get(row.salesEngineerId) || row.salesEngineerId;
    tally[who] = (tally[who] || 0) + row.carrAmount;
    total += row.carrAmount;
  }
  console.log('\nAttributed CARR:');
  for (const [who, amount] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
    console.log(`  ${who.padEnd(24)} ${usd(amount).padStart(12)}`);
  console.log(`  ${'TOTAL'.padEnd(24)} ${usd(total).padStart(12)}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode || 0));
