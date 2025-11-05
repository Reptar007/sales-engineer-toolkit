import * as dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

export function generateJWT(user, roles) {
  // Get JWT secret from environment variables
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  // Validate inputs
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  if (!user || !user.id || !user.email) {
    throw new Error('Invalid user data');
  }
  if (!Array.isArray(roles)) {
    throw new Error('Roles must be an array');
  }

  // Create payload
  const payload = {
    sub: user.id,
    email: user.email,
    roles: roles,
  };

  // Sign and return token
  return jwt.sign(payload, secret, { expiresIn: expiresIn });
}

export function verifyJWT(token) {
  // Get JWT secret from environment variables
  const secret = process.env.JWT_SECRET;

  // Validate inputs
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  if (!token) {
    throw new Error('Token is required');
  }

  // Verify token
  try {
    const decoded = jwt.verify(token, secret);
    return decoded;
  } catch (error) {
    // Handle specific error types
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else {
      throw new Error('Token verification failed');
    }
  }
}
