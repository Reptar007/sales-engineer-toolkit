import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const IS_PROD = process.env.NODE_ENV === 'production';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const token = req.cookies['auth'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, team } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({
        error: 'Email, password, and name are required',
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'User with this email already exists',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        team: team || null,
        mustChangePassword: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        team: true,
        createdAt: true,
      },
    });

    // Generate JWT token
    const token = signToken({ sub: user.id, email: user.email, mcp: false });

    res
      .cookie('auth', token, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        path: '/',
      })
      .status(201)
      .json({
        message: 'User created successfully',
        user,
        token,
      });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }

    // Generate JWT token
    const token = signToken({ sub: user.id, email: user.email, mcp: user.mustChangePassword });

    // Return user data (without password)
    // eslint-disable-next-line no-unused-vars
    const { passwordHash: _, ...userWithoutPassword } = user;

    res
      .cookie('auth', token, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        path: '/',
      })
      .json({
        message: 'Login successful',
        user: userWithoutPassword,
        token,
        mustChangePassword: user.mustChangePassword,
      });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// Verify token endpoint
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies['auth'];

    if (!token) {
      return res.status(401).json({
        error: 'No token provided',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        email: true,
        name: true,
        team: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Invalid token',
      });
    }

    res.json({
      message: 'Token is valid',
      user,
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({
      error: 'Invalid token',
    });
  }
});

// Change password endpoint
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password required' });

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // If user still has mustChangePassword true, you can optionally skip verifying currentPassword
    if (!user.mustChangePassword) {
      const ok = await bcrypt.compare(currentPassword || '', user.passwordHash);
      if (!ok) return res.status(400).json({ error: 'Current password incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });

    const token = signToken({
      sub: updated.id,
      email: updated.email,
      mcp: updated.mustChangePassword,
    });

    res
      .cookie('auth', token, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        path: '/',
      })
      .json({ ok: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user endpoint
router.get('/me', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, team: user.team },
      mustChangePassword: user.mustChangePassword,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  res.clearCookie('auth', { path: '/' }).json({ ok: true });
});

export default router;
