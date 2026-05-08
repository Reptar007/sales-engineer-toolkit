import express from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken } from './middleware/auth.js';
import { requireRole } from './middleware/rbac.js';
import { getPrisma } from './lib/prisma.js';
import { resolveLinearUserByEmail, resolveLinearUserById } from './lib/linearClient.js';
import generateRandomPassword from './utlis/generateRandomPassword.js';

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

// List users with a Sales Engineer role who don't yet have a SalesEngineer
// record (i.e. no team assigned). Used by the admin TeamsPage to populate
// the "Attach SE" picker. Defined ABOVE the `/me/linear` routes so the
// literal `/without-team` segment matches before any future `/:userId`
// patterns might be added.
router.get('/without-team', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const prisma = await getPrisma();
    const seRoles = ['sales_engineer_1', 'sales_engineer_2', 'sales_engineer_lead'];

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        salesEngineer: null,
        userRoles: { some: { role: { in: seRoles } } },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        userRoles: { select: { role: true } },
      },
      orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    });

    return res.status(200).json({
      message: 'Users without a team fetched successfully',
      users,
    });
  } catch (error) {
    console.error('Error getting users without team:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: update a user's profile fields (firstName, lastName, email) and
// optionally their linked SalesEngineer.salesforceEmail. Used by the admin
// Users tab so we can fix up records when an SE changes their name / email
// without having to run a DB migration. Returns the same row shape as the
// GET /users list endpoint so the frontend can drop the new value straight
// into local state.
router.patch('/:userId', authenticateToken, requireRole('admin'), async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const body = req.body ?? {};
  const data = {};

  if (typeof body.firstName === 'string') {
    data.firstName = body.firstName.trim() || null;
  }
  if (typeof body.lastName === 'string') {
    data.lastName = body.lastName.trim() || null;
  }
  if (typeof body.email === 'string') {
    const email = body.email.trim();
    if (!email) {
      return res.status(400).json({ error: 'Email cannot be empty' });
    }
    data.email = email;
  }

  // salesforceEmail lives on SalesEngineer, not User. We accept it on this
  // PATCH for ergonomics (admins think of "this person's email" as one
  // concept) and apply it via a nested update only when the user has an
  // SE record. Pass an empty string to clear it.
  let salesforceEmailUpdate;
  if (typeof body.salesforceEmail === 'string') {
    salesforceEmailUpdate = body.salesforceEmail.trim() || null;
  }

  if (Object.keys(data).length === 0 && salesforceEmailUpdate === undefined) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    const prisma = await getPrisma();

    // Guard against email collisions before we attempt the update so we can
    // return a clean 409 instead of leaking the Prisma unique-constraint
    // error shape to the frontend.
    if (data.email) {
      const existing = await prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== userId) {
        return res.status(409).json({ error: 'Another user already has this email' });
      }
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, salesEngineer: { select: { id: true } } },
    });
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (salesforceEmailUpdate !== undefined && !target.salesEngineer) {
      return res
        .status(400)
        .json({ error: 'Cannot set Salesforce email on a user without a Sales Engineer record' });
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: userId }, data });
      }
      if (salesforceEmailUpdate !== undefined && target.salesEngineer) {
        await tx.salesEngineer.update({
          where: { id: target.salesEngineer.id },
          data: { salesforceEmail: salesforceEmailUpdate },
        });
      }
    });

    const updated = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        userRoles: { select: { role: true } },
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
                  where: { isActive: true },
                  select: { id: true, name: true, salesforceId: true, salesforceEmail: true },
                },
              },
            },
          },
        },
      },
    });

    return res.status(200).json({ message: 'User updated', user: updated });
  } catch (error) {
    console.error('PATCH /users/:userId error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

// Admin: reset a user's password to a freshly generated random value. We set
// `mustChangePassword: true` on the User row so the login flow forces them
// through the change-password screen on next sign-in, regardless of what the
// generated string looks like. The plaintext is returned ONCE in this
// response so the admin UI can display + copy it; we do NOT persist or email
// the plaintext anywhere else.
router.post(
  '/:userId/reset-password',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    try {
      const prisma = await getPrisma();
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const temporaryPassword = generateRandomPassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true },
      });

      return res.status(200).json({
        message: 'Password reset',
        temporaryPassword,
        mustChangeOnNextLogin: true,
      });
    } catch (error) {
      console.error('POST /users/:userId/reset-password error:', error);
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  },
);

router.get('/me/linear', authenticateToken, async (req, res) => {
  try {
    const prisma = await getPrisma();
    const salesEngineer = await prisma.salesEngineer.findUnique({
      where: { userId: req.user.id },
      select: { id: true, linearUserId: true },
    });
    const appEmail = req.user.email;
    const linearUserId = salesEngineer?.linearUserId ?? null;
    let linearUser = null;
    if (linearUserId) {
      try {
        linearUser = await resolveLinearUserById(linearUserId);
      } catch (err) {
        console.error('GET /users/me/linear: resolveLinearUserById failed:', err.message);
      }
    }
    let autoResolvable = false;
    if (!linearUserId && appEmail) {
      try {
        const match = await resolveLinearUserByEmail(appEmail);
        autoResolvable = Boolean(match?.id);
      } catch (err) {
        console.error('GET /users/me/linear: resolveLinearUserByEmail failed:', err.message);
      }
    }
    return res.json({
      hasSalesEngineer: Boolean(salesEngineer),
      linearUserId,
      linearUser,
      appEmail,
      autoResolvable,
    });
  } catch (err) {
    console.error('GET /users/me/linear:', err);
    return res.status(500).json({ error: 'Failed to load Linear profile' });
  }
});

router.put('/me/linear', authenticateToken, async (req, res) => {
  const { linearEmail, linearUserId } = req.body ?? {};
  const hasEmail = typeof linearEmail === 'string' && linearEmail.trim().length > 0;
  const hasId = typeof linearUserId === 'string' && linearUserId.trim().length > 0;

  if (hasEmail && hasId) {
    return res.status(400).json({ error: 'provide_exactly_one' });
  }
  if (!hasEmail && !hasId) {
    return res.status(400).json({ error: 'provide_email_or_id' });
  }

  try {
    const prisma = await getPrisma();
    const salesEngineer = await prisma.salesEngineer.findUnique({
      where: { userId: req.user.id },
      select: { id: true },
    });

    if (!salesEngineer) {
      return res.status(422).json({ error: 'no_sales_engineer' });
    }

    let linearUser = null;
    try {
      linearUser = hasEmail
        ? await resolveLinearUserByEmail(linearEmail.trim())
        : await resolveLinearUserById(linearUserId.trim());
    } catch (err) {
      const status = err.statusCode || 502;
      console.error('PUT /users/me/linear: Linear lookup failed:', err.message);
      return res.status(status).json({ error: 'linear_unavailable' });
    }

    if (!linearUser?.id) {
      return res.status(404).json({ error: 'linear_user_not_found' });
    }

    await prisma.salesEngineer.update({
      where: { id: salesEngineer.id },
      data: { linearUserId: linearUser.id },
    });

    return res.json({
      hasSalesEngineer: true,
      linearUserId: linearUser.id,
      linearUser,
      appEmail: req.user.email,
      autoResolvable: true,
    });
  } catch (err) {
    console.error('PUT /users/me/linear:', err);
    return res.status(500).json({ error: 'Failed to save Linear profile' });
  }
});

router.delete('/me/linear', authenticateToken, async (req, res) => {
  try {
    const prisma = await getPrisma();
    const salesEngineer = await prisma.salesEngineer.findUnique({
      where: { userId: req.user.id },
      select: { id: true },
    });

    if (!salesEngineer) {
      return res.status(422).json({ error: 'no_sales_engineer' });
    }

    await prisma.salesEngineer.update({
      where: { id: salesEngineer.id },
      data: { linearUserId: null },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /users/me/linear:', err);
    return res.status(500).json({ error: 'Failed to disconnect Linear' });
  }
});

export default router;
