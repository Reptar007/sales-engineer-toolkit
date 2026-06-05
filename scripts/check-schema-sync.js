#!/usr/bin/env node
/**
 * Schema drift guard.
 *
 * This repo runs two Prisma schemas:
 *   - backend/prisma/schema.prisma  (SQLite, local dev)
 *   - prisma/schema.prisma          (PostgreSQL, production)
 *
 * The runtime client is chosen at boot from DATABASE_URL (see
 * backend/src/lib/prisma.js), so the two schemas MUST define the same
 * models/enums or a feature works locally and silently breaks in prod
 * (e.g. the Opp table / mustChangePassword column drift incidents).
 *
 * This script compares the `model` and `enum` blocks of the two schemas
 * (ignoring the datasource/generator blocks, comments, and whitespace)
 * and exits non-zero if they diverge. Wired into CI so drift is caught
 * on the PR instead of in production.
 *
 * It deliberately does NOT compare provider-specific bits (native types
 * via `@db.*`, the datasource block, the generator output path). If you
 * ever introduce a `@db.` native type in one schema, extend the
 * normalizer below to strip it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCHEMAS = {
  postgres: resolve(ROOT, 'prisma/schema.prisma'),
  sqlite: resolve(ROOT, 'backend/prisma/schema.prisma'),
};

// Strip `//` / `///` comments (whole-line and trailing). The datasource
// URLs in these schemas never contain `//`, so a naive strip is safe.
function stripComments(line) {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

// Parse a schema file into a Map of "<kind> <Name>" -> normalized body.
// Body is the set of field/attribute lines, whitespace-collapsed and
// sorted so cosmetic reordering or alignment differences don't trip the
// guard. generator/datasource blocks are skipped.
function parseBlocks(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const blocks = new Map();

  let current = null; // { key, body: [] }
  for (const rawLine of lines) {
    const line = stripComments(rawLine).trim();
    if (!line) continue;

    if (current) {
      if (line === '}') {
        const body = current.body
          .map((l) => l.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .sort();
        blocks.set(current.key, body.join('\n'));
        current = null;
      } else {
        current.body.push(line);
      }
      continue;
    }

    const open = line.match(/^(model|enum)\s+(\w+)\s*\{$/);
    if (open) {
      current = { key: `${open[1]} ${open[2]}`, body: [] };
      continue;
    }
    // generator / datasource / stray lines at top level -> ignore.
  }
  return blocks;
}

function diffBodies(a, b) {
  const aLines = new Set(a.split('\n'));
  const bLines = new Set(b.split('\n'));
  const onlyA = [...aLines].filter((l) => !bLines.has(l));
  const onlyB = [...bLines].filter((l) => !aLines.has(l));
  return { onlyA, onlyB };
}

function main() {
  const pg = parseBlocks(SCHEMAS.postgres);
  const sqlite = parseBlocks(SCHEMAS.sqlite);

  const allKeys = [...new Set([...pg.keys(), ...sqlite.keys()])].sort();
  const problems = [];

  for (const key of allKeys) {
    const inPg = pg.has(key);
    const inSqlite = sqlite.has(key);
    if (!inPg) {
      problems.push(
        `  - "${key}" exists in backend/prisma (SQLite) but is MISSING from prisma/ (PostgreSQL/prod).`,
      );
      continue;
    }
    if (!inSqlite) {
      problems.push(
        `  - "${key}" exists in prisma/ (PostgreSQL) but is MISSING from backend/prisma (SQLite/dev).`,
      );
      continue;
    }
    if (pg.get(key) !== sqlite.get(key)) {
      const { onlyA, onlyB } = diffBodies(pg.get(key), sqlite.get(key));
      const detail = [
        `  - "${key}" differs between the two schemas:`,
        ...onlyA.map((l) => `      only in PostgreSQL: ${l}`),
        ...onlyB.map((l) => `      only in SQLite:     ${l}`),
      ];
      problems.push(detail.join('\n'));
    }
  }

  if (problems.length) {
    console.error('\nPrisma schema drift detected between dev (SQLite) and prod (PostgreSQL):\n');
    console.error(problems.join('\n'));
    console.error(
      '\nKeep prisma/schema.prisma and backend/prisma/schema.prisma in sync (and add a migration in BOTH migration dirs). See scripts/check-schema-sync.js.\n',
    );
    process.exit(1);
  }

  console.log('Prisma schemas are in sync (models/enums match across SQLite and PostgreSQL).');
}

main();
