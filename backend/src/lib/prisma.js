import { PrismaClient as BackendPrismaClient } from '@prisma/client';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';

// Use root Prisma client (PostgreSQL) in production, backend client (SQLite) in local dev
let prisma;

if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
  // Production: Try to use root Prisma client for PostgreSQL
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const rootPrismaPath = resolve(__dirname, '../../../generated/prisma/index.js');
    if (existsSync(rootPrismaPath)) {
      const rootPrismaModule = await import(rootPrismaPath);
      prisma = new rootPrismaModule.PrismaClient();
    } else {
      // Fallback to backend client if root client not available
      prisma = new BackendPrismaClient();
    }
  } catch {
    // Fallback to backend client if import fails
    prisma = new BackendPrismaClient();
  }
} else {
  // Local: Use backend Prisma client for SQLite
  prisma = new BackendPrismaClient();
}

export default prisma;
