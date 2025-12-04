import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

const prisma = new PrismaClient();

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
