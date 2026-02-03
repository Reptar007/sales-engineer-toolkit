import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPrisma } from '../src/lib/prisma.js';

// Load environment variables from repo root only
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3] || 'password';

  if (!email) {
    console.error('❌ Usage: node reset-password.js <email> [newPassword]');
    console.error('   Example: node reset-password.js dinhan@qawolf.com password');
    process.exit(1);
  }

  // Get the correct Prisma client (PostgreSQL in production, SQLite locally)
  const prisma = await getPrisma();

  const dbType = process.env.DATABASE_URL?.startsWith('postgres') ? 'PostgreSQL' : 'SQLite';
  console.log(`✅ Using ${dbType} database`);

  try {
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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Error resetting password:', error);
  process.exit(1);
});
