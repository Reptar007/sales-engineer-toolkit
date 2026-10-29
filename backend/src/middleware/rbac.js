import { verifyJWT } from '../utlis/jwt.js';
import { getPrisma } from '../lib/prisma.js';

/** Every role an account can hold; registering and editing a user both check against it. */
export const ALL_ROLES = [
  'admin',
  'sales_engineer_1',
  'sales_engineer_2',
  'sales_engineer_lead',
  'csm',
  'csm_lead',
];

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
 * Check a new set of roles an admin gives an existing account. Answers
 * `{ roles }` (known, deduplicated) or `{ error }`. An account needs at least
 * one role, and an admin cannot take admin away from themselves, so the app
 * is never left with no one to give it back.
 */
export function checkRoleChange(roles, { userId, editorId }) {
  if (!Array.isArray(roles) || roles.length === 0) {
    return { error: 'Pick at least one role.' };
  }
  const unknown = roles.filter((role) => !ALL_ROLES.includes(role));
  if (unknown.length > 0) {
    return { error: `Unknown role(s): ${unknown.join(', ')}` };
  }
  if (userId === editorId && !roles.includes('admin')) {
    return { error: 'You cannot remove your own admin role.' };
  }
  return { roles: [...new Set(roles)] };
}

/** The roles an account holds now, from the database. */
export async function loadRoles(userId) {
  const prisma = await getPrisma();
  const rows = await prisma.userRole.findMany({ where: { userId }, select: { role: true } });
  return rows.map((row) => row.role);
}

/**
 * Keep customer success accounts out of a router built for SEs (pipeline,
 * CARR, calendars, opps, the Bone Pile). Mounted in front of the router,
 * before its own `authenticateToken`: an account whose roles are all CSM
 * roles gets 403; anything else (another role, no token, a bad one) passes
 * through to the router's own checks unchanged, so public routes stay
 * public. The roles come from the database, not the token, so a role an
 * admin changes applies at once rather than at the next sign-in.
 *
 * `rolesFor` is swappable for the tests.
 */
export function makeBlockCsm(rolesFor = loadRoles) {
  return async (req, res, next) => {
    const header = req.headers['authorization'];
    const token = (header && header.split(' ')[1]) || req.cookies?.auth || req.cookies?.token;
    if (!token) return next();
    let decoded;
    try {
      decoded = verifyJWT(token);
    } catch {
      // An invalid token is the router's own auth to reject.
      return next();
    }
    if (!decoded?.sub) return next();
    try {
      if (isCsmOnly(await rolesFor(decoded.sub))) {
        return res.status(403).json({ error: 'Not available to customer success accounts.' });
      }
    } catch (error) {
      console.error('blockCsm could not read roles:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
    return next();
  };
}

export const blockCsm = makeBlockCsm();

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
