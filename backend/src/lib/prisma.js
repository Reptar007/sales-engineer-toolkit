import { PrismaClient as BackendPrismaClient } from '@prisma/client';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';

// Use root Prisma client (PostgreSQL) in production, backend client (SQLite) in local dev
let prisma;

async function initializePrisma() {
  if (prisma) {
    return prisma;
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
    // Production: Use root Prisma client for PostgreSQL
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const rootPrismaPath = resolve(__dirname, '../../../generated/prisma/index.js');

      if (existsSync(rootPrismaPath)) {
        // Import the root Prisma client (generated from root schema.prisma)
        const rootPrismaModule = await import(rootPrismaPath);
        prisma = new rootPrismaModule.PrismaClient();
        console.log('Initialized root Prisma client for PostgreSQL');
      } else {
        console.error('Root Prisma client not found at:', rootPrismaPath);
        throw new Error('Root Prisma client not found');
      }
    } catch (error) {
      console.error('Error initializing root Prisma client:', error);
      throw new Error(
        'Failed to initialize Prisma client. Root Prisma client not found. ' +
          'Ensure Prisma client is generated during build.',
      );
    }
  } else {
    // Local: Use backend Prisma client for SQLite
    prisma = new BackendPrismaClient();
    console.log('Initialized backend Prisma client for SQLite');
  }

  return prisma;
}

// For local development, initialize immediately
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  prisma = new BackendPrismaClient();
}

// Export a getter function that ensures Prisma is initialized
export async function getPrisma() {
  // If prisma is already initialized, return it
  if (prisma) {
    return prisma;
  }

  // If we're in production (PostgreSQL), initialize it
  if (process.env.DATABASE_URL?.startsWith('postgres')) {
    try {
      await initializePrisma();
      if (!prisma) {
        throw new Error('Prisma initialization completed but prisma is still undefined');
      }
      return prisma;
    } catch (error) {
      console.error('Failed to get Prisma client:', error);
      throw new Error(`Failed to initialize Prisma client: ${error.message}`);
    }
  }

  // For local development, prisma should already be initialized
  if (!prisma) {
    throw new Error('Prisma client not initialized. This should not happen in local development.');
  }

  return prisma;
}

// Export the prisma instance and initialization function
export { initializePrisma };
export default prisma;
