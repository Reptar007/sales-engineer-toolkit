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

export default router;
