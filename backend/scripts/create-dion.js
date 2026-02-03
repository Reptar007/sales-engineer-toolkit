import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from repo root only
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

// Try to use root Prisma client (PostgreSQL) or fall back to backend client (SQLite)
let prisma;
try {
  // Try root Prisma client first (for production PostgreSQL)
  const rootPrismaPath = resolve(__dirname, '../../../generated/prisma/index.js');
  const rootPrismaModule = await import(rootPrismaPath);
  prisma = new rootPrismaModule.PrismaClient();
  console.log('✅ Using root Prisma client (PostgreSQL)');
} catch {
  // Fall back to backend Prisma client (SQLite for local)
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  console.log('✅ Using backend Prisma client (SQLite)');
}

async function main() {
  console.log('🔐 Creating Dion Pham user...\n');

  const email = 'dinhan@qawolf.com';
  const password = 'password';
  const firstName = 'Dion';
  const lastName = 'Pham';
  const passwordHash = await bcrypt.hash(password, 12);

  // Check if user exists
  let user = await prisma.user.findUnique({
    where: { email },
    include: { userRoles: true },
  });

  if (user) {
    console.log('⚠️  User already exists. Updating password and roles...');

    // Update password
    await prisma.user.update({
      where: { email },
      data: { passwordHash, firstName, lastName },
    });

    // Update roles
    const existingRoles = user.userRoles.map((ur) => ur.role);
    const requiredRoles = ['admin', 'sales_engineer_2'];

    // Remove roles that shouldn't be there
    for (const role of existingRoles) {
      if (!requiredRoles.includes(role)) {
        await prisma.userRole.deleteMany({
          where: { userId: user.id, role },
        });
      }
    }

    // Add missing roles
    for (const role of requiredRoles) {
      if (!existingRoles.includes(role)) {
        await prisma.userRole.create({
          data: { userId: user.id, role },
        });
      }
    }

    console.log('✅ User updated successfully!');
  } else {
    console.log('📝 Creating new user...');

    // Create user
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        isActive: true,
        userRoles: {
          create: [{ role: 'admin' }, { role: 'sales_engineer_2' }],
        },
      },
      include: { userRoles: true },
    });

    console.log('✅ User created successfully!');
  }

  // Create or update SalesEngineer record
  let team = await prisma.team.findUnique({
    where: { name: 'Team Bowser' },
  });

  if (!team) {
    team = await prisma.team.create({
      data: {
        name: 'Team Bowser',
        description: "Dion's team",
        isActive: true,
      },
    });
    console.log('✅ Created Team Bowser');
  }

  let salesEngineer = await prisma.salesEngineer.findUnique({
    where: { userId: user.id },
  });

  if (!salesEngineer) {
    salesEngineer = await prisma.salesEngineer.create({
      data: {
        userId: user.id,
        teamId: team.id,
        salesforceEmail: email,
        isActive: true,
      },
    });
    console.log('✅ Created SalesEngineer record');
  } else if (salesEngineer.teamId !== team.id) {
    await prisma.salesEngineer.update({
      where: { id: salesEngineer.id },
      data: { teamId: team.id },
    });
    console.log('✅ Updated SalesEngineer team');
  }

  console.log('\n🎉 Done!');
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Roles: admin, sales_engineer_2`);
  console.log(`   Team: Team Bowser`);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
