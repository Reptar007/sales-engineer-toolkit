import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed for Team Kirby...');

  // STEP 1: Create Admin User (Sebastian) - has both admin and sales_engineer_lead roles
  const adminUser = await prisma.user.create({
    data: {
      email: 'sebastian@qawolf.com',
      passwordHash: await bcrypt.hash('password', 10),
      firstName: 'Sebastian',
      lastName: 'Antonucci',
      isActive: true,
      userRoles: {
        create: [{ role: 'admin' }, { role: 'sales_engineer_lead' }],
      },
    },
  });
  console.log('✅ Created admin user:', adminUser.email);

  // STEP 2: Create Team Kirby
  const teamKirby = await prisma.team.create({
    data: {
      name: 'Team Kirby',
      description: "Rebecca's team",
      isActive: true,
    },
  });
  console.log('✅ Created team:', teamKirby.name);

  // STEP 3: Create SE User + SalesEngineer (Becca/Rebecca)
  const seUser = await prisma.user.create({
    data: {
      email: 'rebecca@qawolf.com',
      passwordHash: await bcrypt.hash('password', 10),
      firstName: 'Rebecca',
      lastName: 'Stone',
      isActive: true,
      userRoles: {
        create: [{ role: 'admin' }, { role: 'sales_engineer_2' }],
      },
    },
  });

  const salesEngineer = await prisma.salesEngineer.create({
    data: {
      userId: seUser.id,
      teamId: teamKirby.id,
      salesforceEmail: 'rebecca@qawolf.com',
      isActive: true,
    },
  });
  console.log('✅ Created SE:', seUser.email);

  // STEP 4: Create Account Executives for Team Kirby
  const aeCharlie = await prisma.accountExecutive.create({
    data: {
      name: 'Charlie',
      salesforceId: '0055f00000BLZn7AAH',
      salesforceEmail: 'charlie@qawolf.com',
      teamId: teamKirby.id,
      isActive: true,
    },
  });

  const aeDevin = await prisma.accountExecutive.create({
    data: {
      name: 'Devin Steinke',
      salesforceId: '0055f00000AakC6AAJ',
      salesforceEmail: 'devin@qawolf.com',
      teamId: teamKirby.id,
      isActive: true,
    },
  });

  const aeVeronika = await prisma.accountExecutive.create({
    data: {
      name: 'Veronika Fischer',
      salesforceId: '0055f0000090VlpAAE',
      salesforceEmail: 'veronika@qawolf.com',
      teamId: teamKirby.id,
      isActive: true,
    },
  });
  console.log('✅ Created AEs for Team Kirby');

  // STEP 5: Create Team Assignments (SE ↔ AE mapping)
  // Becca is assigned to all AEs in her team
  await prisma.teamAssignment.create({
    data: {
      salesEngineerId: salesEngineer.id,
      accountExecutiveId: aeCharlie.id,
      isActive: true,
    },
  });

  await prisma.teamAssignment.create({
    data: {
      salesEngineerId: salesEngineer.id,
      accountExecutiveId: aeDevin.id,
      isActive: true,
    },
  });

  await prisma.teamAssignment.create({
    data: {
      salesEngineerId: salesEngineer.id,
      accountExecutiveId: aeVeronika.id,
      isActive: true,
    },
  });
  console.log('✅ Created team assignments');

  console.log('🎉 Seed completed successfully!');
  console.log('\n📝 Summary:');
  console.log(`   Admin: ${adminUser.email}`);
  console.log(`   Team: ${teamKirby.name}`);
  console.log(`   SE: ${seUser.email}`);
  console.log(`   AEs: Charlie, Devin Steinke, Veronika`);
}

main()
  .catch((error) => {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
