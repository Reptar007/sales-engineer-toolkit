import { verifyJWT } from '../utlis/jwt.js';
import { getPrisma } from '../lib/prisma.js';

export const authenticateToken = async (req, res, next) => {
  try {
    // Extract token from Authorization header (Bearer <token>)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Also check cookies as fallback
    const cookieToken = req.cookies?.auth || req.cookies?.token;

    // Use header token first, fallback to cookie
    const authToken = token || cookieToken;

    if (!authToken) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token using JWT utility
    const decoded = verifyJWT(authToken);

    // Get user from database with roles
    const prisma = await getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub }, // Use sub instead of userId
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
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

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    // Attach user to request object with roles array
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.userRoles.map((ur) => ur.role), // Extract roles array
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);

    // Handle specific error types
    if (error.message === 'Token has expired') {
      return res.status(401).json({ error: 'Token has expired' });
    }

    if (error.message === 'Invalid token' || error.message === 'Token is required') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Generic error for other cases
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

export default authenticateToken;
