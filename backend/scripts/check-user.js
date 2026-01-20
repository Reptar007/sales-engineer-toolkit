import { getPrisma } from '../src/lib/prisma.js';

async function main() {
  const email = process.argv[2] || 'ian@qawolf.com';

  const prisma = await getPrisma();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
    },
  });

  if (user) {
    console.log('✅ User found:');
    console.log(JSON.stringify(user, null, 2));
  } else {
    console.log(`❌ User with email ${email} not found`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
