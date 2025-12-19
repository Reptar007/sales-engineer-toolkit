import express from 'express';
import { authenticateToken } from './middleware/auth.js';
import { requireRole } from './middleware/rbac.js';
import { getPrisma } from './lib/prisma.js';

const router = express.Router();

// Get all users
router.get('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        userRoles: {
          select: {
            role: true,
          },
        },
        salesEngineer: {
          select: {
            id: true,
            teamId: true,
            salesforceEmail: true,
            salesforceId: true,
            isActive: true,
            team: {
              select: {
                id: true,
                name: true,
                description: true,
                isActive: true,
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
            },
          },
        },
      },
    });

    return res.status(200).json({
      message: 'Users fetched successfully',
      users: users,
    });
  } catch (error) {
    console.error('Error getting users:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
