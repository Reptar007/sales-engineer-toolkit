import express from 'express';
import bcrypt from 'bcryptjs';
import { generateJWT } from '../utlis/jwt.js';
import validatePassword from '../utlis/passwordValidation.js';
import generateRandomPassword from '../utlis/generateRandomPassword.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { getPrisma } from '../lib/prisma.js';

const router = express.Router();

// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate inputs
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user from DB
    const prisma = await getPrisma();
    if (!prisma) {
      console.error('Prisma client is undefined after getPrisma() call');
      return res.status(500).json({ error: 'Database connection error' });
    }
    if (!prisma.user) {
      console.error('Prisma client does not have user model. Prisma:', prisma);
      return res.status(500).json({ error: 'Database model error' });
    }
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: true,
        // Pull the user's SE team (and that team's active AEs) in the same
        // query so the login response matches /auth/me exactly. Without
        // this the dashboard renders without the "Team {name}" chip OR
        // the SE-scoped tiles on first login and only picks them up on
        // the next page reload.
        salesEngineer: {
          select: {
            team: {
              select: {
                id: true,
                name: true,
                accountExecutives: {
                  where: { isActive: true },
                  select: { id: true, name: true },
                  orderBy: { name: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    // Check if user exists
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const roles = user.userRoles.map((ur) => ur.role);
    const token = generateJWT(user, roles);
    // Two ways a user can land in the must-change-password state:
    //   1. The admin reset their password (sets `user.mustChangePassword`).
    //   2. Legacy seed accounts whose stored hash matches the literal
    //      "password" — kept for backwards compat with users that pre-date
    //      the explicit flag and haven't been touched since.
    const mustChangePassword = Boolean(user.mustChangePassword) || password === 'password';

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: roles,
        team: user.salesEngineer?.team ?? null,
      },
      // mustChangePassword forces the post-login change-password flow on
      // first sign-in. Keep this field — the change-password endpoint now
      // returns the same `user.team` shape (with active AEs) so the
      // dashboard tiles stay populated across that hop.
      mustChangePassword,
    });
  } catch (error) {
    console.error('Login error:', error);
    // In development, return more details; in production, return generic message
    const errorMessage =
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message || 'Internal server error';
    return res.status(500).json({
      error: errorMessage,
      ...(process.env.NODE_ENV !== 'production' && { details: error.stack }),
    });
  }
});

// Change password route
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate inputs
    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    // Validate new password
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Password validation failed',
        errors: validation.errors,
      });
    }

    // Prevent changing to default password
    if (newPassword === 'password') {
      return res
        .status(400)
        .json({ error: 'Cannot use the default password. Please choose a different password.' });
    }

    // Get user from database (need passwordHash for verification)
    const prisma = await getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        mustChangePassword: true,
        userRoles: {
          select: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Allow skipping the "current password" challenge when:
    //   1. Admin reset the password (mustChangePassword flag is set), OR
    //   2. Legacy: stored hash still matches the literal seed default.
    // Both signal that the user is being forced through this flow rather
    // than proactively rotating a credential they already know.
    const hasDefaultPassword = await bcrypt.compare('password', user.passwordHash);
    const skipCurrentPasswordCheck = user.mustChangePassword || hasDefaultPassword;

    if (!skipCurrentPasswordCheck) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }

      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({ error: 'Invalid current password' });
      }

      // Check if new password is different from current password
      const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
      if (isSamePassword) {
        return res
          .status(400)
          .json({ error: 'New password must be different from current password' });
      }
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password and reload the same shape the login + /me endpoints
    // return so the frontend can replace user state without losing team
    // membership (see frontend/src/contexts/AuthProvider.jsx#changePassword,
    // which does setUser(data.user) — if team is missing here, the dashboard
    // header drops the "Team {name}" chip until the next page refresh hits
    // /auth/me).
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      // Clear the must-change-password flag once the user has actually picked
      // a new credential, so subsequent logins land directly on the dashboard.
      data: { passwordHash: newPasswordHash, mustChangePassword: false },
      include: {
        userRoles: true,
        salesEngineer: {
          select: {
            team: {
              select: {
                id: true,
                name: true,
                accountExecutives: {
                  where: { isActive: true },
                  select: { id: true, name: true },
                  orderBy: { name: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    const roles = updatedUser.userRoles.map((ur) => ur.role);
    const token = generateJWT(updatedUser, roles);

    return res.status(200).json({
      message: 'Password changed successfully',
      token,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        roles: roles,
        team: updatedUser.salesEngineer?.team ?? null,
      },
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Register route (admin only)
router.post('/register', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    // Check if body is parsed
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const { email, password, firstName, lastName, roles, teamId, teamName, teamDescription } =
      req.body;

    // Validate inputs. `password` is now optional — when omitted we generate
    // a cryptographically random temp password and force a change on first
    // login (same flow the admin reset-password endpoint uses).
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Email, firstName, and lastName are required' });
    }

    // If the caller DID provide a password, still enforce the policy. Skip
    // the policy when we're auto-generating because our generator is
    // guaranteed to satisfy it.
    const wantsAutoPassword = !password;
    if (!wantsAutoPassword) {
      const validation = validatePassword(password);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Password validation failed',
          errors: validation.errors,
        });
      }
    }

    // Validate and normalize roles
    const allowedRoles = ['admin', 'sales_engineer_1', 'sales_engineer_2', 'sales_engineer_lead'];
    let userRoles = roles;

    // Normalize roles: convert string to array, default to sales_engineer_1 if not provided
    if (!userRoles) {
      userRoles = ['sales_engineer_1']; // Default role
    } else if (typeof userRoles === 'string') {
      userRoles = [userRoles]; // Convert string to array
    } else if (!Array.isArray(userRoles)) {
      return res.status(400).json({ error: 'Roles must be a string or array' });
    }

    // Validate all roles are allowed
    const invalidRoles = userRoles.filter((role) => !allowedRoles.includes(role));
    if (invalidRoles.length > 0) {
      return res.status(400).json({
        error: 'Invalid role(s) provided',
        invalidRoles: invalidRoles,
        allowedRoles: allowedRoles,
      });
    }

    // Reject mutually-exclusive team payloads up front so we don't have to
    // unwind a partially-created user later.
    if (teamId && teamName) {
      return res.status(400).json({
        error: 'Provide either teamId (existing team) or teamName (new team), not both',
      });
    }

    // Check if email is already in use
    const prisma = await getPrisma();
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // Resolve / generate the plaintext password. We hold onto the plaintext
    // only long enough to surface it in the response — it's never persisted
    // anywhere besides the bcrypt hash.
    const generatedPassword = wantsAutoPassword ? generateRandomPassword() : null;
    const effectivePassword = generatedPassword ?? password;
    const passwordHash = await bcrypt.hash(effectivePassword, 12);

    // Check if user has SE role (sales_engineer_1, sales_engineer_2, or sales_engineer_lead)
    const hasSERole = userRoles.some((role) =>
      ['sales_engineer_1', 'sales_engineer_2', 'sales_engineer_lead'].includes(role),
    );

    // Team affordances are only meaningful for SEs.
    if ((teamName || teamId) && !hasSERole) {
      return res.status(400).json({
        error: 'Team can only be assigned to users with sales engineer roles',
      });
    }

    // Pre-validate the team payload before we create the User row so a 409
    // doesn't leave behind a half-provisioned account.
    let existingTeam = null;
    if (teamId) {
      existingTeam = await prisma.team.findUnique({ where: { id: teamId } });
      if (!existingTeam) {
        return res.status(404).json({ error: 'Selected team not found' });
      }
      // Each team has exactly one SE; refuse to clobber the existing one.
      const currentSE = await prisma.salesEngineer.findFirst({
        where: { teamId, isActive: true },
        select: { id: true },
      });
      if (currentSE) {
        return res.status(409).json({
          error: 'That team already has a Sales Engineer assigned',
        });
      }
    }
    if (teamName) {
      const conflict = await prisma.team.findUnique({ where: { name: teamName } });
      if (conflict) {
        return res.status(409).json({ error: 'Team with this name already exists' });
      }
    }

    // Create user with specified roles
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        // When the admin didn't pick a password we issued a random one and
        // need the user to rotate it on first login.
        mustChangePassword: wantsAutoPassword,
        userRoles: {
          create: userRoles.map((role) => ({ role })), // Create one UserRole per role
        },
      },
      include: { userRoles: true }, // Include roles in response
    });

    let team = null;
    let salesEngineer = null;

    if (hasSERole && (teamName || teamId)) {
      if (teamId) {
        team = existingTeam;
      } else {
        team = await prisma.team.create({
          data: {
            name: teamName,
            description: teamDescription || null,
            isActive: true,
          },
        });
      }

      salesEngineer = await prisma.salesEngineer.create({
        data: {
          userId: user.id,
          teamId: team.id,
          salesforceEmail: email, // Use user's email as default
          isActive: true,
        },
      });
    }

    // Extract roles from user
    const userRolesArray = user.userRoles.map((ur) => ur.role);

    // Build response. We deliberately do NOT issue a JWT here anymore — this
    // endpoint runs under the admin's token and the prior behavior of
    // returning a token caused the AuthProvider on the client to swap the
    // admin's session for the new user's. Callers that want to log in as
    // the new user should hit /auth/login afterwards.
    const response = {
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: userRolesArray,
      },
    };

    // Include team info if created
    if (team && salesEngineer) {
      response.team = {
        id: team.id,
        name: team.name,
        description: team.description,
      };
    }

    // Surface the generated plaintext exactly once so the admin UI can copy
    // it. Omitted entirely when the admin supplied their own password.
    if (generatedPassword) {
      response.temporaryPassword = generatedPassword;
      response.mustChangeOnNextLogin = true;
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password route
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const prisma = await getPrisma();
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        isActive: true,
      },
    });

    // Always return success message (security best practice - don't reveal if email exists)
    // In a production environment, you would:
    // 1. Generate a reset token
    // 2. Store it in the database with expiration
    // 3. Send an email with the reset link
    // 4. Return success message regardless of whether user exists

    if (user && user.isActive) {
      // TODO: Generate reset token, store in DB, send email
      // For now, just return success message
      return res.status(200).json({
        message: 'If an account exists with this email, a password reset link has been sent.',
      });
    }

    // Return same message even if user doesn't exist (security)
    return res.status(200).json({
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user route. Returns the user + their SE team + the team's active AEs
// so the dashboard can show SE-scoped tiles and tooltips ("My CARR filtered
// by N AEs") without an extra round-trip.
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const prisma = await getPrisma();
    const se = await prisma.salesEngineer.findUnique({
      where: { userId: user.id },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            accountExecutives: {
              where: { isActive: true },
              select: { id: true, name: true },
              orderBy: { name: 'asc' },
            },
          },
        },
      },
    });
    return res.status(200).json({
      message: 'User retrieved successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles,
        team: se?.team ?? null,
      },
    });
  } catch (error) {
    console.error('User retrieval error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
