import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

// Try to use root Prisma client (PostgreSQL) or fall back to backend client (SQLite)
let prisma;
try {
  // Try root Prisma client first (for production PostgreSQL)
  const rootPrismaPath = resolve(__dirname, '../../../generated/prisma/index.js');
  if (existsSync(rootPrismaPath) && process.env.DATABASE_URL?.startsWith('postgres')) {
    const rootPrismaModule = await import(rootPrismaPath);
    prisma = new rootPrismaModule.PrismaClient();
    console.log('✅ Using root Prisma client (PostgreSQL)');
  } else {
    throw new Error('Use backend client');
  }
} catch {
  // Fall back to backend Prisma client (SQLite for local)
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  console.log('✅ Using backend Prisma client (SQLite)');
}

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3] || 'password';

  if (!email) {
    console.error('❌ Usage: node reset-password.js <email> [newPassword]');
    console.error('   Example: node reset-password.js dinhan@qawolf.com password');
    process.exit(1);
  }

  console.log(`🔐 Resetting password for ${email}...`);

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.error(`❌ User with email ${email} not found`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  console.log(`✅ Password reset successfully for ${email}`);
  console.log(`   New password: ${newPassword}`);
}

main()
  .catch((error) => {
    console.error('❌ Error resetting password:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
