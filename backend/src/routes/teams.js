import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { getPrisma } from '../lib/prisma.js';

const router = express.Router();

// Get all teams
router.get('/', authenticateToken, async (req, res) => {
  try {
    const prisma = await getPrisma();
    const teams = await prisma.team.findMany({
      where: {
        isActive: true,
      },
      include: {
        salesEngineer: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        accountExecutives: {
          where: {
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            salesforceId: true,
            salesforceEmail: true,
          },
        },
      },
    });
    return res.status(200).json({
      message: 'Teams fetched successfully',
      teams: teams,
    });
  } catch (error) {
    console.error('Error getting teams:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a team by id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        salesEngineer: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        accountExecutives: {
          where: {
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            salesforceId: true,
            salesforceEmail: true,
          },
        },
      },
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (!team.isActive) {
      return res.status(404).json({ error: 'Team not found' });
    }

    return res.status(200).json({
      message: 'Team fetched successfully',
      team: team,
    });
  } catch (error) {
    console.error('Error getting team:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a team (for existing SE - use register endpoint to create SE with team)
router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { name, description, userId } = req.body;

    // Validate inputs
    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    // Check if team name already exists
    const existingTeam = await prisma.team.findUnique({ where: { name } });
    if (existingTeam) {
      return res.status(409).json({ error: 'Team with this name already exists' });
    }

    // If userId provided, validate SE exists and doesn't already have a team
    if (userId) {
      const existingSE = await prisma.salesEngineer.findUnique({
        where: { userId },
        include: { user: { select: { email: true } } },
      });

      if (!existingSE) {
        return res.status(404).json({
          error: 'Sales Engineer not found. User must have a sales engineer role.',
        });
      }

      // Check if SE already has a team
      if (existingSE.teamId) {
        return res.status(409).json({
          error: 'Sales Engineer already has a team assigned',
        });
      }

      // Create team and update SalesEngineer
      const team = await prisma.team.create({
        data: {
          name,
          description: description || null,
          isActive: true,
          salesEngineer: {
            connect: { userId },
          },
        },
        include: {
          salesEngineer: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });

      return res.status(201).json({
        message: 'Team created successfully and assigned to Sales Engineer',
        team: team,
      });
    }

    // Create standalone team (no SE assigned yet)
    const team = await prisma.team.create({
      data: {
        name,
        description: description || null,
        isActive: true,
      },
    });

    return res.status(201).json({
      message: 'Team created successfully. Assign to a Sales Engineer to complete setup.',
      team: team,
    });
  } catch (error) {
    console.error('Error creating team:', error);

    // Handle Prisma unique constraint errors
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Team with this name already exists' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Add AE to team
router.post('/:teamId/aes', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { teamId } = req.params;
    const { name, salesforceId, salesforceEmail } = req.body;

    // Validate inputs
    if (!name || !salesforceId) {
      return res.status(400).json({ error: 'Name and salesforceId are required' });
    }

    // Check if team exists
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { salesEngineer: true },
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (!team.isActive) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Check if salesforceId already exists
    const existingAE = await prisma.accountExecutive.findUnique({
      where: { salesforceId },
    });

    if (existingAE) {
      return res.status(409).json({
        error: 'Account Executive with this Salesforce ID already exists',
        existingAE: {
          id: existingAE.id,
          name: existingAE.name,
          teamId: existingAE.teamId,
        },
      });
    }

    // Create AE
    const ae = await prisma.accountExecutive.create({
      data: {
        name,
        salesforceId,
        salesforceEmail: salesforceEmail || null,
        teamId: teamId,
        isActive: true,
      },
    });

    // If team has a SalesEngineer, create TeamAssignment automatically
    let teamAssignment = null;
    if (team.salesEngineer) {
      try {
        teamAssignment = await prisma.teamAssignment.create({
          data: {
            salesEngineerId: team.salesEngineer.id,
            accountExecutiveId: ae.id,
            isActive: true,
          },
        });
      } catch (assignmentError) {
        // If assignment already exists, that's ok (shouldn't happen, but handle gracefully)
        console.warn('Team assignment already exists:', assignmentError);
      }
    }

    return res.status(201).json({
      message: 'AE added to team successfully',
      ae: ae,
      teamAssignment: teamAssignment
        ? 'Team assignment created automatically'
        : 'No Sales Engineer assigned to team',
    });
  } catch (error) {
    console.error('Error adding AE to team:', error);

    // Handle Prisma unique constraint errors
    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0];
      if (field === 'salesforceId') {
        return res
          .status(409)
          .json({ error: 'Account Executive with this Salesforce ID already exists' });
      }
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update team (rename / toggle active)
router.patch('/:teamId', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { teamId } = req.params;
    const { name, description, isActive } = req.body ?? {};

    if (name === undefined && description === undefined && isActive === undefined) {
      return res
        .status(400)
        .json({ error: 'Provide at least one of: name, description, isActive' });
    }

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const updates = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      updates.name = name.trim();
    }
    if (description !== undefined) {
      updates.description = description === null ? null : String(description);
    }
    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean' });
      }
      updates.isActive = isActive;
    }

    const updated = await prisma.team.update({
      where: { id: teamId },
      data: updates,
      include: {
        salesEngineer: {
          include: {
            user: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
          },
        },
        accountExecutives: {
          where: { isActive: true },
          select: { id: true, name: true, salesforceId: true, salesforceEmail: true },
        },
      },
    });

    return res.status(200).json({ message: 'Team updated successfully', team: updated });
  } catch (error) {
    console.error('Error updating team:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Team with this name already exists' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update AE (rename, change email, or move to another team)
router.patch('/:teamId/aes/:aeId', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { teamId, aeId } = req.params;
    const { name, salesforceEmail, teamId: newTeamId } = req.body ?? {};

    if (name === undefined && salesforceEmail === undefined && newTeamId === undefined) {
      return res
        .status(400)
        .json({ error: 'Provide at least one of: name, salesforceEmail, teamId' });
    }

    const ae = await prisma.accountExecutive.findUnique({ where: { id: aeId } });
    if (!ae || ae.teamId !== teamId) {
      return res.status(404).json({ error: 'Account Executive not found on this team' });
    }

    const updates = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      updates.name = name.trim();
    }
    if (salesforceEmail !== undefined) {
      updates.salesforceEmail = salesforceEmail === null ? null : String(salesforceEmail);
    }

    let destinationTeam = null;
    if (newTeamId !== undefined && newTeamId !== teamId) {
      destinationTeam = await prisma.team.findUnique({
        where: { id: newTeamId },
        include: { salesEngineer: true },
      });
      if (!destinationTeam || !destinationTeam.isActive) {
        return res.status(404).json({ error: 'Destination team not found' });
      }
      updates.teamId = newTeamId;
    }

    // When moving teams, also fix TeamAssignment rows so the AE shows up
    // under the destination team's SE and stops counting toward the source
    // team's SE. Done in a transaction so an unexpected failure doesn't
    // leave the AE half-moved.
    if (destinationTeam) {
      const sourceTeam = await prisma.team.findUnique({
        where: { id: teamId },
        include: { salesEngineer: true },
      });

      const opsList = [prisma.accountExecutive.update({ where: { id: aeId }, data: updates })];

      if (sourceTeam?.salesEngineer) {
        opsList.push(
          prisma.teamAssignment.updateMany({
            where: {
              accountExecutiveId: aeId,
              salesEngineerId: sourceTeam.salesEngineer.id,
            },
            data: { isActive: false },
          }),
        );
      }

      if (destinationTeam.salesEngineer) {
        opsList.push(
          prisma.teamAssignment.upsert({
            where: {
              salesEngineerId_accountExecutiveId: {
                salesEngineerId: destinationTeam.salesEngineer.id,
                accountExecutiveId: aeId,
              },
            },
            update: { isActive: true },
            create: {
              salesEngineerId: destinationTeam.salesEngineer.id,
              accountExecutiveId: aeId,
              isActive: true,
            },
          }),
        );
      }

      await prisma.$transaction(opsList);
    } else {
      await prisma.accountExecutive.update({ where: { id: aeId }, data: updates });
    }

    const refreshed = await prisma.accountExecutive.findUnique({
      where: { id: aeId },
      include: {
        team: { select: { id: true, name: true } },
      },
    });

    return res.status(200).json({
      message: 'Account Executive updated successfully',
      ae: refreshed,
    });
  } catch (error) {
    console.error('Error updating AE:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Soft-delete AE: deactivate the AE row and any of its TeamAssignment rows
router.delete('/:teamId/aes/:aeId', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { teamId, aeId } = req.params;

    const ae = await prisma.accountExecutive.findUnique({ where: { id: aeId } });
    if (!ae || ae.teamId !== teamId) {
      return res.status(404).json({ error: 'Account Executive not found on this team' });
    }

    await prisma.$transaction([
      prisma.accountExecutive.update({
        where: { id: aeId },
        data: { isActive: false },
      }),
      prisma.teamAssignment.updateMany({
        where: { accountExecutiveId: aeId },
        data: { isActive: false },
      }),
    ]);

    return res.status(200).json({ message: 'Account Executive deactivated successfully', aeId });
  } catch (error) {
    console.error('Error deactivating AE:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Attach an existing SE-role user to a team (for SEs created without a team).
// Refuses to re-parent an SE who already has a team — admin must move the
// SE explicitly via a different flow to avoid silent reassignment.
router.post('/:teamId/se', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const { teamId } = req.params;
    const { userId, salesforceEmail } = req.body ?? {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { salesEngineer: true },
    });
    if (!team || !team.isActive) {
      return res.status(404).json({ error: 'Team not found' });
    }
    if (team.salesEngineer) {
      return res.status(409).json({ error: 'Team already has a Sales Engineer assigned' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: true, salesEngineer: true },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const seRoles = ['sales_engineer_1', 'sales_engineer_2', 'sales_engineer_lead'];
    const hasSERole = user.userRoles.some((ur) => seRoles.includes(ur.role));
    if (!hasSERole) {
      return res.status(400).json({ error: 'User does not have a Sales Engineer role' });
    }
    if (user.salesEngineer) {
      return res.status(409).json({
        error: 'User is already a Sales Engineer on a team',
        currentTeamId: user.salesEngineer.teamId,
      });
    }

    const se = await prisma.salesEngineer.create({
      data: {
        userId: user.id,
        teamId: team.id,
        salesforceEmail: salesforceEmail ?? user.email,
        isActive: true,
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        team: { select: { id: true, name: true } },
      },
    });

    return res
      .status(201)
      .json({ message: 'Sales Engineer attached to team successfully', salesEngineer: se });
  } catch (error) {
    console.error('Error attaching SE to team:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
