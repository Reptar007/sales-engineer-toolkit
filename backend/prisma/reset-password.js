import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'sebastian@qawolf.com';
  const newPassword = 'password'; // Reset to default password

  console.log(`🔄 Resetting password for ${email}...`);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.error(`❌ User with email ${email} not found`);
    process.exit(1);
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Update password
  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  console.log(`✅ Password reset successfully for ${email}`);
  console.log(`📝 New password: ${newPassword}`);
  console.log(`⚠️  Remember to change your password after logging in!`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
