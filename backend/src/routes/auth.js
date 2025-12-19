import express from 'express';
import bcrypt from 'bcryptjs';
import { generateJWT } from '../utlis/jwt.js';
import validatePassword from '../utlis/passwordValidation.js';
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
    const isDefaultPassword = password === 'password';

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: roles,
      },
      mustChangePassword: isDefaultPassword,
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

    // Check if user has default password (allow skipping current password verification)
    const hasDefaultPassword = await bcrypt.compare('password', user.passwordHash);

    // If not default password, verify current password
    if (!hasDefaultPassword) {
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

    // Update password
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
      include: { userRoles: true },
    });

    // Extract roles and generate new token
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

    const { email, password, firstName, lastName, roles, teamName, teamDescription } = req.body;

    // Validate inputs
    if (!email || !password || !firstName || !lastName) {
      return res
        .status(400)
        .json({ error: 'Email, password, firstName, and lastName are required' });
    }

    // Validate password
    const validation = validatePassword(password);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Password validation failed',
        errors: validation.errors,
      });
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

    // Check if email is already in use
    const prisma = await getPrisma();
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Check if user has SE role (sales_engineer_1, sales_engineer_2, or sales_engineer_lead)
    const hasSERole = userRoles.some((role) =>
      ['sales_engineer_1', 'sales_engineer_2', 'sales_engineer_lead'].includes(role),
    );

    // Validate: If teamName is provided, user must have SE role
    if (teamName && !hasSERole) {
      return res.status(400).json({
        error: 'Team can only be created for users with sales engineer roles',
      });
    }

    // Validate: If teamName is provided, check if it's already taken
    if (teamName) {
      const existingTeam = await prisma.team.findUnique({ where: { name: teamName } });
      if (existingTeam) {
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
        userRoles: {
          create: userRoles.map((role) => ({ role })), // Create one UserRole per role
        },
      },
      include: { userRoles: true }, // Include roles in response
    });

    let team = null;
    let salesEngineer = null;

    // If user has SE role and teamName is provided, create Team and SalesEngineer
    if (hasSERole && teamName) {
      // Create team
      team = await prisma.team.create({
        data: {
          name: teamName,
          description: teamDescription || null,
          isActive: true,
        },
      });

      // Create SalesEngineer linking user to team
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
    const token = generateJWT(user, userRolesArray);

    // Build response
    const response = {
      message: 'User created successfully',
      token,
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

// Get user route
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    return res.status(200).json({
      message: 'User retrieved successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles,
      },
    });
  } catch (error) {
    console.error('User retrieval error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
