import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables (Prisma will automatically use DATABASE_URL if set)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

const prisma = new PrismaClient();

// AE Directory mapping
const aeDirectory = {
  Ben: {
    notionId: '1a4d872b-594c-8120-8195-0002fb831ac8',
    slackId: 'U08ENS3FKFF',
    team: 'Team Zelda',
    email: 'benbarrett@qawolf.com',
  },
  Burke: {
    notionId: '0bf23f5b-227d-4f98-b266-50562b749bb5',
    slackId: 'U048HTL0V26',
    team: 'Team Yoshi',
    email: 'burke@qawolf.com',
  },
  Charlie: {
    notionId: '345a9592-697a-458c-abba-e6403b5859d1',
    slackId: 'U050UFLTS6M',
    team: 'Team Zelda',
    email: 'charlie@qawolf.com',
  },
  Colin: {
    notionId: '20ad872b-594c-81ac-9585-0002a2798690',
    slackId: 'U090F3RH1NE',
    team: 'Team Yoshi',
    email: 'colin@qawolf.com',
  },
  'Dan McDevitt': {
    notionId: '5a35b2a994fb82fca28a81c3768831ba',
    slackId: 'U090F3RH1NE',
    team: 'Team Sonic',
    email: 'dan@qawolf.com',
  },
  'Devin Steinke': {
    notionId: 'e9a49ee7-fe70-41b2-9d9d-c2937c489967',
    slackId: 'U09DCK2F51Q',
    team: 'Team Kirby',
    email: 'devin@qawolf.com',
  },
  'Devin Aebischer': {
    notionId: '21fd872b-594c-81c6-9e67-0002b0cfa191',
    slackId: 'U093URLLG1F',
    team: 'Team Bowser',
    email: 'devinaebischer@qawolf.com',
  },
  Jason: {
    notionId: '489a4637-ecf9-49b8-b844-f035db2ed1f6',
    slackId: 'U03TFTTDZ46',
    team: 'Team Sonic',
    email: 'jason@qawolf.com',
  },
  Jordan: {
    notionId: '21fd872b-594c-8129-99de-00021e3a78a9',
    slackId: 'U093GC3USAY',
    team: 'Team Kirby',
    email: 'jordan.vanitallie@qawolf.com',
  },
  Kathryn: {
    notionId: '51ea5bea-7722-4bad-bfee-ffe2c5db389f',
    slackId: 'U06C0CHCY2Y',
    team: 'Team Bowser',
    email: 'kathryn@qawolf.com',
  },
  'Robert Kenkel': {
    notionId: '237d872b-594c-81cc-b0bc-00020a4625b6',
    slackId: 'U097G4S0CAC',
    team: 'Team Yoshi',
    email: 'robkenkel@qawolf.com',
  },
  'Rob Linsmayer': {
    notionId: '15b2230f-e184-48ed-840d-dcb83546c2ea',
    slackId: 'U06R20FJU30',
    team: 'Team Yoshi',
    email: 'rob@qawolf.com',
  },
  Sally: {
    notionId: '21fd872b-594c-81db-9968-00029265d402',
    slackId: 'U0943CVDAQ0',
    team: 'Team Bowser',
    email: 'sally@qawolf.com',
  },
  Stephen: {
    notionId: '1e0d872b-594c-816f-a3d6-0002e7e00bf9',
    slackId: 'U08PTBB03A6',
    team: 'Team Sonic',
    email: 'stephen@qawolf.com',
  },
  Veronika: {
    notionId: 'cbc52faa-1de7-46d8-8ede-c6c434ba8485',
    slackId: 'U03DRH07QUW',
    team: 'Team Kirby',
    email: 'veronika@qawolf.com',
  },
};

// SE Mapping
const seMapping = {
  'Team Bowser': {
    notionId: '7f9aaca0-8dc1-4ee9-a6bb-cf45774d33dc',
    email: 'dinhan@qawolf.com',
    seName: 'Dion Pham',
    slackId: 'U060XD5BE22',
  },
  'Team Yoshi': {
    notionId: '101d872b-594c-812b-9762-00022b9727a0',
    email: 'ricky@qawolf.com',
    seName: 'Ricky Moore',
    slackId: 'U07N3VC3G3A',
  },
  'Team Mario': {
    notionId: '502bcd9f-6f54-4421-b8f3-79035b1fe6c5',
    email: 'sebastian@qawolf.com',
    seName: 'Sebastian Antonucci',
    slackId: 'U051XCHTEK1',
  },
  'Team Kirby': {
    notionId: 'b2916065-2221-49f4-93b7-85be8480d397',
    email: 'rebecca@qawolf.com',
    seName: 'Rebecca Stone',
    slackId: 'U040J1L057S',
  },
  'Team Sonic': {
    notionId: '55ac35f2-ba66-4a28-aaac-33d3ab0a1abe',
    email: 'ian@qawolf.com',
    seName: 'Ian Schaefer',
    slackId: 'U07AZQZAQTV',
  },
  'Team Zelda': {
    notionId: 'c30e6313-fa6d-40ff-af98-634725d39eb0',
    email: 'jun@qawolf.com',
    seName: 'Jun Park',
    slackId: 'U06BNTQ2006',
  },
};

// Helper function to extract first and last name from email or name
function parseName(email, seName) {
  if (seName) {
    const parts = seName.trim().split(/\s+/);
    return {
      firstName: parts[0] || null,
      lastName: parts.slice(1).join(' ') || null,
    };
  }
  // Extract from email
  const emailName = email.split('@')[0];
  const parts = emailName.split(/[._-]/);
  return {
    firstName: parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : null,
    lastName: parts.slice(1).join(' ') || null,
  };
}

async function main() {
  console.log('🌱 Starting comprehensive seed for all teams, SEs, and AEs...\n');

  const defaultPassword = 'password';
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  // Step 1: Create all teams
  console.log('📦 Step 1: Creating teams...');
  const teams = {};
  for (const [teamName, seData] of Object.entries(seMapping)) {
    if (teamName === 'None') continue; // Skip "None" team

    let team = await prisma.team.findUnique({
      where: { name: teamName },
    });

    if (!team) {
      team = await prisma.team.create({
        data: {
          name: teamName,
          description: `${seData.seName || 'SE'}'s team`,
          isActive: true,
        },
      });
      console.log(`   ✅ Created team: ${teamName}`);
    } else {
      console.log(`   ⏭️  Team already exists: ${teamName}`);
    }
    teams[teamName] = team;
  }
  console.log('');

  // Step 2: Create all SE users and SalesEngineer records
  console.log('👤 Step 2: Creating Sales Engineers...');
  const salesEngineers = {};
  for (const [teamName, seData] of Object.entries(seMapping)) {
    if (teamName === 'None') continue;

    const { firstName, lastName } = parseName(seData.email, seData.seName);

    // Find or create user
    let seUser = await prisma.user.findUnique({
      where: { email: seData.email },
      include: { userRoles: true },
    });

    // Determine roles based on email
    let requiredRoles;
    if (seData.email === 'sebastian@qawolf.com') {
      requiredRoles = ['admin', 'sales_engineer_lead'];
    } else if (seData.email === 'rebecca@qawolf.com' || seData.email === 'dinhan@qawolf.com') {
      requiredRoles = ['admin', 'sales_engineer_2'];
    } else {
      requiredRoles = ['sales_engineer_1'];
    }

    if (!seUser) {
      seUser = await prisma.user.create({
        data: {
          email: seData.email,
          passwordHash,
          firstName,
          lastName,
          isActive: true,
          userRoles: {
            create: requiredRoles.map((role) => ({ role })),
          },
        },
        include: { userRoles: true },
      });
      console.log(`   ✅ Created SE user: ${seData.email} (${requiredRoles.join(', ')})`);
    } else {
      // Update password hash to ensure it's correct
      await prisma.user.update({
        where: { id: seUser.id },
        data: { passwordHash },
      });
      console.log(`   🔄 Updated password for ${seData.email}`);
      // Ensure roles exist and remove incorrect ones
      const existingRoles = seUser.userRoles.map((ur) => ur.role);

      // Remove roles that shouldn't be there
      const rolesToRemove = existingRoles.filter((role) => !requiredRoles.includes(role));
      for (const role of rolesToRemove) {
        await prisma.userRole.deleteMany({
          where: {
            userId: seUser.id,
            role,
          },
        });
        console.log(`   ➖ Removed role ${role} from ${seData.email}`);
      }

      // Add missing roles
      for (const role of requiredRoles) {
        if (!existingRoles.includes(role)) {
          await prisma.userRole.create({
            data: { userId: seUser.id, role },
          });
          console.log(`   ➕ Added role ${role} to ${seData.email}`);
        }
      }
      // Update name if it's different
      if (seUser.firstName !== firstName || seUser.lastName !== lastName) {
        await prisma.user.update({
          where: { id: seUser.id },
          data: { firstName, lastName },
        });
        console.log(`   🔄 Updated name for ${seData.email}: ${firstName} ${lastName}`);
      }
      console.log(`   ⏭️  SE user already exists: ${seData.email}`);
    }

    // Create or update SalesEngineer record
    const team = teams[teamName];
    if (!team) {
      console.log(`   ⚠️  Team ${teamName} not found, skipping SE creation`);
      continue;
    }

    let salesEngineer = await prisma.salesEngineer.findUnique({
      where: { userId: seUser.id },
    });

    if (!salesEngineer) {
      salesEngineer = await prisma.salesEngineer.create({
        data: {
          userId: seUser.id,
          teamId: team.id,
          salesforceEmail: seData.email,
          isActive: true,
        },
      });
      console.log(`   ✅ Created SalesEngineer record for ${seData.email}`);
    } else {
      // Update team if it changed
      if (salesEngineer.teamId !== team.id) {
        await prisma.salesEngineer.update({
          where: { id: salesEngineer.id },
          data: { teamId: team.id },
        });
        console.log(`   🔄 Updated SalesEngineer team for ${seData.email}`);
      } else {
        console.log(`   ⏭️  SalesEngineer record already exists for ${seData.email}`);
      }
    }
    salesEngineers[teamName] = salesEngineer;
  }
  console.log('');

  // Step 3: Create all Account Executives
  console.log('💼 Step 3: Creating Account Executives...');
  const accountExecutives = {};

  for (const [aeName, aeData] of Object.entries(aeDirectory)) {
    const teamName = aeData.team;
    const team = teams[teamName];

    if (!team) {
      console.log(`   ⚠️  Team ${teamName} not found for AE ${aeName}, skipping`);
      continue;
    }

    // Use notionId as salesforceId (or generate one if needed)
    const salesforceId = aeData.notionId || `notion_${aeName.replace(/\s+/g, '_')}`;

    let ae = await prisma.accountExecutive.findUnique({
      where: { salesforceId },
    });

    if (!ae) {
      ae = await prisma.accountExecutive.create({
        data: {
          name: aeName,
          salesforceId,
          salesforceEmail: aeData.email,
          teamId: team.id,
          isActive: true,
        },
      });
      console.log(`   ✅ Created AE: ${aeName} (${aeData.email}) → ${teamName}`);
    } else {
      // Update team if it changed
      if (ae.teamId !== team.id) {
        await prisma.accountExecutive.update({
          where: { id: ae.id },
          data: { teamId: team.id },
        });
        console.log(`   🔄 Updated AE ${aeName} team to ${teamName}`);
      } else {
        console.log(`   ⏭️  AE already exists: ${aeName}`);
      }
    }

    if (!accountExecutives[teamName]) {
      accountExecutives[teamName] = [];
    }
    accountExecutives[teamName].push(ae);
  }
  console.log('');

  // Step 4: Create Team Assignments (SE ↔ AE mappings)
  console.log('🔗 Step 4: Creating Team Assignments...');
  for (const [teamName, salesEngineer] of Object.entries(salesEngineers)) {
    const aes = accountExecutives[teamName] || [];

    for (const ae of aes) {
      const assignment = await prisma.teamAssignment.findUnique({
        where: {
          salesEngineerId_accountExecutiveId: {
            salesEngineerId: salesEngineer.id,
            accountExecutiveId: ae.id,
          },
        },
      });

      if (!assignment) {
        await prisma.teamAssignment.create({
          data: {
            salesEngineerId: salesEngineer.id,
            accountExecutiveId: ae.id,
            isActive: true,
          },
        });
        console.log(`   ✅ Created assignment: ${teamName} SE ↔ ${ae.name}`);
      } else {
        console.log(`   ⏭️  Assignment already exists: ${teamName} SE ↔ ${ae.name}`);
      }
    }
  }
  console.log('');

  // Summary
  console.log('🎉 Seed completed successfully!\n');
  console.log('📝 Summary:');
  console.log(`   Teams: ${Object.keys(teams).length}`);
  console.log(`   Sales Engineers: ${Object.keys(salesEngineers).length}`);

  const totalAEs = Object.values(accountExecutives).reduce((sum, aes) => sum + aes.length, 0);
  console.log(`   Account Executives: ${totalAEs}`);

  console.log('\n👑 Special roles:');
  console.log('   Sebastian (sebastian@qawolf.com): admin, sales_engineer_lead');
  console.log('   Rebecca (rebecca@qawolf.com): admin, sales_engineer_2');
  console.log('   Dion Pham (dinhan@qawolf.com): admin, sales_engineer_2');
  console.log('   All other SEs: sales_engineer_1');
  console.log('\n🔑 Default password for all users: password');
}

main()
  .catch((error) => {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
