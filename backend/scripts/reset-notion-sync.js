/**
 * Dev utility: clear the Notion handoff metadata on every Opp so the
 * Hunt Board page reverts from "Open in Notion" back to "Send to Notion".
 * The previously-created Notion pages aren't touched -- archive them in
 * Notion if you want them gone.
 *
 * Usage:
 *   node scripts/reset-notion-sync.js              # clear all opps
 *   node scripts/reset-notion-sync.js "Acme Corp"  # clear opps matching name (contains, case-insensitive)
 */
import { getPrisma } from '../src/lib/prisma.js';

async function main() {
  const nameFilter = process.argv[2];
  const prisma = await getPrisma();

  const where = nameFilter ? { oppName: { contains: nameFilter, mode: 'insensitive' } } : {};

  const before = await prisma.opp.findMany({
    where: { ...where, notionPageUrl: { not: null } },
    select: { id: true, oppName: true, notionPageUrl: true },
  });

  if (before.length === 0) {
    console.log(
      'No opps with notionPageUrl set.' + (nameFilter ? ` (filter: "${nameFilter}")` : ''),
    );
    await prisma.$disconnect();
    return;
  }

  console.log(`Clearing Notion sync state on ${before.length} opp(s):`);
  for (const o of before) {
    console.log(`  - ${o.oppName} (${o.id}) -> ${o.notionPageUrl}`);
  }

  const result = await prisma.opp.updateMany({
    where,
    data: {
      notionPageId: null,
      notionPageUrl: null,
      notionSyncedAt: null,
    },
  });

  console.log(`Done. Updated ${result.count} row(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
