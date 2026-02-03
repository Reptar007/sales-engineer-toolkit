// Use the exact same Prisma client as the backend
import prisma from '../src/lib/prisma.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from repo root only
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

async function main() {
  console.log('🔐 Updating Dion password...\n');

  const email = 'dinhan@qawolf.com';
  const newPassword = 'password';
  const passwordHash = await bcrypt.hash(newPassword, 12);

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.error(`❌ User with email ${email} not found`);
    console.error('   Make sure DATABASE_URL is set correctly');
    process.exit(1);
  }

  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  console.log(`✅ Password updated successfully for ${email}`);
  console.log(`   New password: ${newPassword}`);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
