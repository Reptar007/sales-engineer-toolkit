import { verifyJWT } from '../utlis/jwt.js';

/** Customer success roles: they see their self-serve clients and Lone Wolves only. */
export const CSM_ROLES = ['csm', 'csm_lead'];

/**
 * True for an account that is customer success and nothing else. Someone
 * with an SE or admin role as well keeps everything that role gives.
 */
export function isCsmOnly(roles = []) {
  return roles.length > 0 && roles.every((role) => CSM_ROLES.includes(role));
}

/**
 * Keep customer success accounts out of a router built for SEs (pipeline,
 * CARR, calendars, opps, the Bone Pile). Mounted in front of the router,
 * before its own `authenticateToken`, so it reads the roles the token was
 * issued with rather than loading the user again: a token whose roles are
 * all CSM roles gets 403; anything else (another role, no token, a bad one)
 * passes through to the router's own checks unchanged, so public routes
 * stay public. A CSM later given an SE role signs in again to get it.
 */
export const blockCsm = (req, res, next) => {
  const header = req.headers['authorization'];
  const token = (header && header.split(' ')[1]) || req.cookies?.auth || req.cookies?.token;
  if (!token) return next();
  try {
    const decoded = verifyJWT(token);
    if (isCsmOnly(decoded?.roles || [])) {
      return res.status(403).json({ error: 'Not available to customer success accounts.' });
    }
  } catch {
    // An invalid token is the router's own auth to reject.
  }
  return next();
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user || !req.user.roles) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Normalize roles input (handle both string and array)
    const requiredRoles = Array.isArray(roles) ? roles : [roles];
    const userRoles = req.user.roles || [];

    // Admin has access to everything
    if (userRoles.includes('admin')) {
      return next();
    }

    // Check if user has any of the required roles
    const hasRequiredRole = requiredRoles.some((role) => userRoles.includes(role));

    if (!hasRequiredRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};
