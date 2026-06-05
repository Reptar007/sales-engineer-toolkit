/**
 * Backfill the `currentStage` snapshot on every Opp by querying
 * Salesforce in a single bulk SOQL call. Useful after the
 * 20260519210000_add_opp_current_stage migration so the Hunt Board
 * directory shows colored pills without waiting for each SE to open
 * their opps individually.
 *
 * Match priority for each Opp:
 *   1. salesforceOpportunityId (exact ID match in the SF response)
 *   2. case-insensitive oppName match (first hit)
 *
 * Unmatched Opps (no SF record, no name match) are left as null so the
 * directory just shows the "unknown" pill -- safer than guessing.
 *
 * Usage (from backend/):
 *   node scripts/backfill-opp-stages.js
 *   node scripts/backfill-opp-stages.js --dry-run
 */
// The repo's .env lives at the project root, not in backend/. The
// running server loads both paths explicitly; this script does the same
// so it works no matter which directory you invoke it from.
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

const { getPrisma } = await import('../src/lib/prisma.js');
const { getSalesforceConnection } = await import('../src/projects/salesforce/functions.js');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const prisma = await getPrisma();

  const opps = await prisma.opp.findMany({
    select: {
      id: true,
      oppName: true,
      salesforceOpportunityId: true,
      currentStage: true,
    },
  });

  if (opps.length === 0) {
    console.log('No opps found.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Loaded ${opps.length} opp(s). Querying Salesforce...`);

  const conn = await getSalesforceConnection();

  // Pull every Opportunity name our DB knows about in one SOQL call.
  // SF doesn't like apostrophes in IN-lists, so we escape them.
  const names = [...new Set(opps.map((o) => o.oppName).filter(Boolean))];
  const ids = [...new Set(opps.map((o) => o.salesforceOpportunityId).filter(Boolean))];

  const quoted = (s) => `'${String(s).replace(/'/g, "\\'")}'`;
  const whereParts = [];
  if (names.length) whereParts.push(`Name IN (${names.map(quoted).join(', ')})`);
  if (ids.length) whereParts.push(`Id IN (${ids.map(quoted).join(', ')})`);
  if (whereParts.length === 0) {
    console.log('Nothing to look up (no names or SF IDs on any Opp).');
    await prisma.$disconnect();
    return;
  }

  const soql = `SELECT Id, Name, StageName FROM Opportunity WHERE ${whereParts.join(' OR ')}`;
  const result = await conn.query(soql);
  const records = result.records || [];
  console.log(`SF returned ${records.length} record(s).`);

  // Index for fast lookups.
  const byId = new Map();
  const byNameLower = new Map();
  for (const r of records) {
    byId.set(r.Id, r);
    const k = (r.Name || '').trim().toLowerCase();
    if (k && !byNameLower.has(k)) byNameLower.set(k, r);
  }

  let updated = 0;
  let unchanged = 0;
  let unmatched = 0;

  for (const opp of opps) {
    let sfRecord = null;
    let matchVia = null;
    if (opp.salesforceOpportunityId) {
      sfRecord = byId.get(opp.salesforceOpportunityId) || null;
      if (sfRecord) matchVia = 'id';
    }
    if (!sfRecord) {
      const key = (opp.oppName || '').trim().toLowerCase();
      sfRecord = key ? byNameLower.get(key) || null : null;
      if (sfRecord) matchVia = 'name';
    }
    if (!sfRecord) {
      unmatched += 1;
      console.log(`  [skip] ${opp.oppName} (${opp.id}) -- no SF match`);
      continue;
    }
    const nextStage = sfRecord.StageName || null;
    console.log(
      `  ${opp.oppName} (${opp.id}) [via ${matchVia}]\n    sf.Id=${sfRecord.Id} sf.Name=${JSON.stringify(sfRecord.Name)} sf.StageName=${JSON.stringify(sfRecord.StageName)}\n    db.currentStage=${JSON.stringify(opp.currentStage)} -> next=${JSON.stringify(nextStage)}`,
    );
    if (nextStage === opp.currentStage) {
      unchanged += 1;
      continue;
    }
    if (!DRY_RUN) {
      await prisma.opp.update({
        where: { id: opp.id },
        data: { currentStage: nextStage, stageSyncedAt: new Date() },
      });
    }
    updated += 1;
  }

  console.log('');
  console.log(
    `Summary: ${updated} updated, ${unchanged} unchanged, ${unmatched} unmatched.${DRY_RUN ? ' (dry run -- no writes)' : ''}`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
