import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed for Team Kirby...');

  // STEP 1: Create or get Admin User (Sebastian) - has both admin and sales_engineer_lead roles
  let adminUser = await prisma.user.findUnique({
    where: { email: 'sebastian@qawolf.com' },
    include: { userRoles: true },
  });

  if (!adminUser) {
    adminUser = await prisma.user.create({
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
      include: { userRoles: true },
    });
    console.log('✅ Created admin user:', adminUser.email);
  } else {
    // Ensure roles exist
    const existingRoles = adminUser.userRoles.map((ur) => ur.role);
    if (!existingRoles.includes('admin')) {
      await prisma.userRole.create({
        data: { userId: adminUser.id, role: 'admin' },
      });
    }
    if (!existingRoles.includes('sales_engineer_lead')) {
      await prisma.userRole.create({
        data: { userId: adminUser.id, role: 'sales_engineer_lead' },
      });
    }
    console.log('✅ Admin user already exists:', adminUser.email);
  }

  // STEP 2: Create or get Team Kirby
  let teamKirby = await prisma.team.findUnique({
    where: { name: 'Team Kirby' },
  });

  if (!teamKirby) {
    teamKirby = await prisma.team.create({
      data: {
        name: 'Team Kirby',
        description: "Rebecca's team",
        isActive: true,
      },
    });
    console.log('✅ Created team:', teamKirby.name);
  } else {
    console.log('✅ Team already exists:', teamKirby.name);
  }

  // STEP 3: Create or get SE User + SalesEngineer (Becca/Rebecca)
  let seUser = await prisma.user.findUnique({
    where: { email: 'rebecca@qawolf.com' },
    include: { userRoles: true },
  });

  if (!seUser) {
    seUser = await prisma.user.create({
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
      include: { userRoles: true },
    });
    console.log('✅ Created SE user:', seUser.email);
  } else {
    // Ensure roles exist
    const existingRoles = seUser.userRoles.map((ur) => ur.role);
    if (!existingRoles.includes('admin')) {
      await prisma.userRole.create({
        data: { userId: seUser.id, role: 'admin' },
      });
    }
    if (!existingRoles.includes('sales_engineer_2')) {
      await prisma.userRole.create({
        data: { userId: seUser.id, role: 'sales_engineer_2' },
      });
    }
    console.log('✅ SE user already exists:', seUser.email);
  }

  let salesEngineer = await prisma.salesEngineer.findUnique({
    where: { userId: seUser.id },
  });

  if (!salesEngineer) {
    salesEngineer = await prisma.salesEngineer.create({
      data: {
        userId: seUser.id,
        teamId: teamKirby.id,
        salesforceEmail: 'rebecca@qawolf.com',
        isActive: true,
      },
    });
    console.log('✅ Created SalesEngineer record');
  } else {
    console.log('✅ SalesEngineer record already exists');
  }

  // STEP 4: Create or get Account Executives for Team Kirby
  let aeCharlie = await prisma.accountExecutive.findUnique({
    where: { salesforceId: '0055f00000BLZn7AAH' },
  });

  if (!aeCharlie) {
    aeCharlie = await prisma.accountExecutive.create({
      data: {
        name: 'Charlie',
        salesforceId: '0055f00000BLZn7AAH',
        salesforceEmail: 'charlie@qawolf.com',
        teamId: teamKirby.id,
        isActive: true,
      },
    });
  }

  let aeDevin = await prisma.accountExecutive.findUnique({
    where: { salesforceId: '0055f00000AakC6AAJ' },
  });

  if (!aeDevin) {
    aeDevin = await prisma.accountExecutive.create({
      data: {
        name: 'Devin Steinke',
        salesforceId: '0055f00000AakC6AAJ',
        salesforceEmail: 'devin@qawolf.com',
        teamId: teamKirby.id,
        isActive: true,
      },
    });
  }

  let aeVeronika = await prisma.accountExecutive.findUnique({
    where: { salesforceId: '0055f0000090VlpAAE' },
  });

  if (!aeVeronika) {
    aeVeronika = await prisma.accountExecutive.create({
      data: {
        name: 'Veronika Fischer',
        salesforceId: '0055f0000090VlpAAE',
        salesforceEmail: 'veronika@qawolf.com',
        teamId: teamKirby.id,
        isActive: true,
      },
    });
  }
  console.log('✅ AEs for Team Kirby ready');

  // STEP 5: Create Team Assignments (SE ↔ AE mapping) if they don't exist
  // Becca is assigned to all AEs in her team
  const assignment1 = await prisma.teamAssignment.findUnique({
    where: {
      salesEngineerId_accountExecutiveId: {
        salesEngineerId: salesEngineer.id,
        accountExecutiveId: aeCharlie.id,
      },
    },
  });

  if (!assignment1) {
    await prisma.teamAssignment.create({
      data: {
        salesEngineerId: salesEngineer.id,
        accountExecutiveId: aeCharlie.id,
        isActive: true,
      },
    });
  }

  const assignment2 = await prisma.teamAssignment.findUnique({
    where: {
      salesEngineerId_accountExecutiveId: {
        salesEngineerId: salesEngineer.id,
        accountExecutiveId: aeDevin.id,
      },
    },
  });

  if (!assignment2) {
    await prisma.teamAssignment.create({
      data: {
        salesEngineerId: salesEngineer.id,
        accountExecutiveId: aeDevin.id,
        isActive: true,
      },
    });
  }

  const assignment3 = await prisma.teamAssignment.findUnique({
    where: {
      salesEngineerId_accountExecutiveId: {
        salesEngineerId: salesEngineer.id,
        accountExecutiveId: aeVeronika.id,
      },
    },
  });

  if (!assignment3) {
    await prisma.teamAssignment.create({
      data: {
        salesEngineerId: salesEngineer.id,
        accountExecutiveId: aeVeronika.id,
        isActive: true,
      },
    });
  }
  console.log('✅ Team assignments ready');

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
