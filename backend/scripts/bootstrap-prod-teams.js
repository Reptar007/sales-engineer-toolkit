/**
 * bootstrap-prod-teams.js
 *
 * Idempotent bootstrap of the current SE/AE/Team roster (Apr 2026 screenshot)
 * against either local SQLite (backend/prisma/dev.db) or prod Postgres.
 *
 * Safe to re-run: every write is an upsert; AEs no longer on a team are
 * soft-deactivated rather than deleted; existing user passwords/roles are
 * never touched (Ricky is the only user this script may create).
 *
 * Run locally:
 *   cd backend && node scripts/bootstrap-prod-teams.js
 *
 * Run against prod:
 *   DATABASE_URL="postgres://..." node backend/scripts/bootstrap-prod-teams.js
 *
 * Required env (only when creating Ricky):
 *   BOOTSTRAP_DEFAULT_PASSWORD=<plaintext password to bcrypt for ricky@qawolf.com>
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

// Mirror backend/src/lib/prisma.js exactly so the script always writes to
// the same database the running API reads from:
//   - DATABASE_URL starts with `postgres` → use the root generated Postgres
//     client (prod / Prisma Postgres direct).
//   - Otherwise (incl. unset, `file:`, `prisma+postgres://`) → fall back to
//     the backend SQLite client. The backend itself doesn't connect via
//     `prisma+postgres://` because of this same check.
let prisma;
let dbLabel;
try {
  // backend/scripts/ → ../../ = workspace root → generated/prisma/index.js
  const rootPrismaPath = resolve(__dirname, '../../generated/prisma/index.js');
  if (existsSync(rootPrismaPath) && process.env.DATABASE_URL?.startsWith('postgres')) {
    const rootPrisma = await import(rootPrismaPath);
    prisma = new rootPrisma.PrismaClient();
    let host = '<unknown>';
    try {
      host = new URL(process.env.DATABASE_URL).host;
    } catch {
      // ignore parse errors, host stays unknown
    }
    dbLabel = `Postgres (${host})`;
  } else {
    throw new Error('Use backend client');
  }
} catch {
  prisma = new PrismaClient();
  dbLabel = 'SQLite (backend/prisma/dev.db)';
}

// ---------------------------------------------------------------------------
// Source of truth: Current Team Pairings (screenshot, Apr 2026)
// ---------------------------------------------------------------------------

const ROSTER = {
  'Team Yoshi': {
    se: 'ricky@qawolf.com',
    aes: ["Colin O'Connor", 'Chris Burke', 'Robert Linsmayer'],
  },
  'Team Bowser': {
    se: 'dinhan@qawolf.com',
    aes: ['Kathryn Hajjar', 'Sally Lopez', 'Daniel Tsimerman'],
  },
  'Team Sonic': {
    se: 'ian@qawolf.com',
    aes: ['Stephen Stabile', 'Jason Minster', 'Sam McElrea'],
  },
  'Team Kirby': {
    se: 'becca@qawolf.com',
    aes: ['Devin Steinke', 'Veronika Fischer', 'Jordan Van Itallie'],
  },
  'Team Zelda': {
    se: 'jun@qawolf.com',
    aes: ['Ben Barrett', 'Charlie Pie'],
  },
  'Team Mario': {
    se: 'sebastian@qawolf.com',
    aes: [],
  },
};

// Maps the new full-name roster to the short keys used by the older
// seed-all-teams.js so that already-onboarded AEs in local dev or prod
// keep their existing salesforceId / salesforceEmail. New AEs (Daniel
// Tsimerman, Sam McElrea) intentionally have no entry and will be
// created with a `bootstrap_<slug>` placeholder salesforceId.
const LEGACY_AE_NAME_BY_FULL_NAME = {
  "Colin O'Connor": 'Colin',
  'Chris Burke': 'Burke',
  'Robert Linsmayer': 'Rob Linsmayer',
  'Kathryn Hajjar': 'Kathryn',
  'Sally Lopez': 'Sally',
  'Stephen Stabile': 'Stephen',
  'Jason Minster': 'Jason',
  'Devin Steinke': 'Devin Steinke',
  'Veronika Fischer': 'Veronika',
  'Jordan Van Itallie': 'Jordan',
  'Ben Barrett': 'Ben',
  'Charlie Pie': 'Charlie',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Stats accumulator for the final summary
const stats = {
  usersCreated: 0,
  usersSkipped: 0,
  teamsUpserted: 0,
  aesCreated: 0,
  aesUpdated: 0,
  aesUnchanged: 0,
  aesDeactivated: 0,
  assignmentsCreated: 0,
  assignmentsReactivated: 0,
  assignmentsSkipped: 0,
  warnings: [],
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function upsertTeams() {
  console.log('📦 Upserting teams...');
  const teams = {};
  for (const teamName of Object.keys(ROSTER)) {
    const team = await prisma.team.upsert({
      where: { name: teamName },
      update: { isActive: true },
      create: { name: teamName, isActive: true, description: `${teamName} roster` },
    });
    teams[teamName] = team;
    stats.teamsUpserted += 1;
    console.log(`   ✅ ${teamName}`);
  }
  console.log('');
  return teams;
}

async function ensureSEUser(email) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    stats.usersSkipped += 1;
    return existing;
  }

  if (email !== 'ricky@qawolf.com') {
    const msg = `User ${email} not found and is not Ricky — skipping. Create via admin UI before re-running.`;
    console.log(`   ⚠️  ${msg}`);
    stats.warnings.push(msg);
    return null;
  }

  const password = process.env.BOOTSTRAP_DEFAULT_PASSWORD;
  if (!password) {
    const msg = 'BOOTSTRAP_DEFAULT_PASSWORD not set — cannot create ricky@qawolf.com.';
    console.log(`   ⚠️  ${msg}`);
    stats.warnings.push(msg);
    return null;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Ricky',
      lastName: 'Moore',
      isActive: true,
      userRoles: { create: [{ role: 'sales_engineer_1' }] },
    },
  });
  stats.usersCreated += 1;
  console.log(`   ✅ Created user ricky@qawolf.com (sales_engineer_1)`);
  return user;
}

async function upsertSEs(teams) {
  console.log('👤 Upserting Sales Engineers...');
  const salesEngineers = {};
  for (const [teamName, { se: email }] of Object.entries(ROSTER)) {
    const user = await ensureSEUser(email);
    if (!user) continue;

    const team = teams[teamName];
    const existingSE = await prisma.salesEngineer.findUnique({ where: { userId: user.id } });

    if (existingSE && existingSE.teamId !== team.id) {
      const currentTeam = await prisma.team.findUnique({ where: { id: existingSE.teamId } });
      const msg = `SE ${email} already on team "${currentTeam?.name ?? existingSE.teamId}" — refusing to reassign to "${teamName}". Move via admin UI.`;
      console.log(`   ⚠️  ${msg}`);
      stats.warnings.push(msg);
      salesEngineers[teamName] = existingSE;
      continue;
    }

    const se = await prisma.salesEngineer.upsert({
      where: { userId: user.id },
      update: { isActive: true },
      create: {
        userId: user.id,
        teamId: team.id,
        salesforceEmail: email,
        isActive: true,
      },
    });
    salesEngineers[teamName] = se;
    console.log(`   ✅ ${email} → ${teamName}`);
  }
  console.log('');
  return salesEngineers;
}

async function findExistingAE(teamId, fullName) {
  const candidateNames = [fullName];
  const legacyName = LEGACY_AE_NAME_BY_FULL_NAME[fullName];
  if (legacyName && legacyName !== fullName) candidateNames.push(legacyName);

  return prisma.accountExecutive.findFirst({
    where: { teamId, name: { in: candidateNames } },
  });
}

async function upsertAEs(teams) {
  console.log('💼 Upserting Account Executives...');
  const accountExecutives = {}; // teamName -> AE[]
  for (const [teamName, { aes }] of Object.entries(ROSTER)) {
    accountExecutives[teamName] = [];
    const team = teams[teamName];
    if (!team) continue;

    for (const fullName of aes) {
      const existing = await findExistingAE(team.id, fullName);

      if (existing) {
        const updates = {};
        if (existing.name !== fullName) updates.name = fullName;
        if (!existing.isActive) updates.isActive = true;

        if (Object.keys(updates).length > 0) {
          const updated = await prisma.accountExecutive.update({
            where: { id: existing.id },
            data: updates,
          });
          stats.aesUpdated += 1;
          console.log(
            `   🔄 ${teamName}: "${existing.name}" → "${fullName}" (kept salesforceId=${existing.salesforceId})`,
          );
          accountExecutives[teamName].push(updated);
        } else {
          stats.aesUnchanged += 1;
          accountExecutives[teamName].push(existing);
        }
        continue;
      }

      const placeholderId = `bootstrap_${slugify(fullName)}`;
      const created = await prisma.accountExecutive.create({
        data: {
          name: fullName,
          salesforceId: placeholderId,
          teamId: team.id,
          isActive: true,
        },
      });
      stats.aesCreated += 1;
      console.log(`   ✅ ${teamName}: created "${fullName}" (placeholder id=${placeholderId})`);
      accountExecutives[teamName].push(created);
    }
  }
  console.log('');
  return accountExecutives;
}

async function deactivateStaleAEs(teams) {
  console.log('🧹 Deactivating stale AEs...');

  const rosterFullNamesByTeam = new Map();
  for (const [teamName, { aes }] of Object.entries(ROSTER)) {
    const set = new Set(aes);
    for (const full of aes) {
      const legacy = LEGACY_AE_NAME_BY_FULL_NAME[full];
      if (legacy) set.add(legacy);
    }
    rosterFullNamesByTeam.set(teamName, set);
  }

  for (const [teamName, team] of Object.entries(teams)) {
    const allowed = rosterFullNamesByTeam.get(teamName) || new Set();
    const teamAEs = await prisma.accountExecutive.findMany({ where: { teamId: team.id } });

    for (const ae of teamAEs) {
      if (allowed.has(ae.name)) continue;
      if (!ae.isActive) continue;

      await prisma.accountExecutive.update({
        where: { id: ae.id },
        data: { isActive: false },
      });
      await prisma.teamAssignment.updateMany({
        where: { accountExecutiveId: ae.id },
        data: { isActive: false },
      });
      stats.aesDeactivated += 1;
      console.log(`   🚫 Deactivated AE "${ae.name}" on ${teamName} (and assignments)`);
    }
  }
  console.log('');
}

async function upsertAssignments(salesEngineers, accountExecutives) {
  console.log('🔗 Upserting team assignments...');
  for (const [teamName, se] of Object.entries(salesEngineers)) {
    const aes = accountExecutives[teamName] || [];
    for (const ae of aes) {
      const existing = await prisma.teamAssignment.findUnique({
        where: {
          salesEngineerId_accountExecutiveId: {
            salesEngineerId: se.id,
            accountExecutiveId: ae.id,
          },
        },
      });

      if (!existing) {
        await prisma.teamAssignment.create({
          data: {
            salesEngineerId: se.id,
            accountExecutiveId: ae.id,
            isActive: true,
          },
        });
        stats.assignmentsCreated += 1;
        console.log(`   ✅ ${teamName} SE ↔ ${ae.name}`);
      } else if (!existing.isActive) {
        await prisma.teamAssignment.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
        stats.assignmentsReactivated += 1;
        console.log(`   ♻️  Reactivated ${teamName} SE ↔ ${ae.name}`);
      } else {
        stats.assignmentsSkipped += 1;
      }
    }
  }
  console.log('');
}

async function printRosterSummary(teams) {
  console.log('🧾 Final per-team roster (compare to screenshot):');
  for (const [teamName, team] of Object.entries(teams)) {
    const se = await prisma.salesEngineer.findUnique({
      where: { teamId: team.id },
      include: { user: true },
    });
    const aes = await prisma.accountExecutive.findMany({
      where: { teamId: team.id, isActive: true },
      orderBy: { name: 'asc' },
    });
    const seLabel = se?.user
      ? `${se.user.firstName ?? ''} ${se.user.lastName ?? ''}`.trim() || se.user.email
      : '(no SE)';
    console.log(`\n   ${teamName} — SE: ${seLabel}`);
    if (aes.length === 0) {
      console.log('     (no active AEs)');
    } else {
      for (const ae of aes) {
        const sfdcLabel = ae.salesforceId.startsWith('bootstrap_')
          ? '⚠️  placeholder salesforceId'
          : `salesforceId=${ae.salesforceId}`;
        console.log(`     • ${ae.name}  [${sfdcLabel}]`);
      }
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🔌 Connected to: ${dbLabel}\n`);

  const teams = await upsertTeams();
  const salesEngineers = await upsertSEs(teams);
  const accountExecutives = await upsertAEs(teams);
  await deactivateStaleAEs(teams);
  await upsertAssignments(salesEngineers, accountExecutives);
  await printRosterSummary(teams);

  console.log('📊 Summary:');
  console.log(`   Users created: ${stats.usersCreated}`);
  console.log(`   Users skipped (already existed or missing): ${stats.usersSkipped}`);
  console.log(`   Teams upserted: ${stats.teamsUpserted}`);
  console.log(`   AEs created: ${stats.aesCreated}`);
  console.log(`   AEs updated: ${stats.aesUpdated}`);
  console.log(`   AEs unchanged: ${stats.aesUnchanged}`);
  console.log(`   AEs deactivated: ${stats.aesDeactivated}`);
  console.log(`   Assignments created: ${stats.assignmentsCreated}`);
  console.log(`   Assignments reactivated: ${stats.assignmentsReactivated}`);
  console.log(`   Assignments unchanged: ${stats.assignmentsSkipped}`);

  if (stats.warnings.length > 0) {
    console.log(`\n⚠️  ${stats.warnings.length} warning(s):`);
    for (const w of stats.warnings) console.log(`   - ${w}`);
  }

  console.log('\n✅ Bootstrap complete.\n');
}

main()
  .catch((error) => {
    console.error('❌ Bootstrap failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
