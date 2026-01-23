/**
 * Universal tRPC Setup
 * This provides a shared tRPC configuration that can be used across all projects
 */

import { initTRPC, TRPCError } from '@trpc/server';
import { verifyJWT } from '../utlis/jwt.js';
import { getPrisma } from './prisma.js';

/**
 * Create tRPC context from Express request
 * This context is available in all tRPC procedures
 * @param {Object} opts - Options containing req and res from Express
 */
export async function createContext(opts) {
  const { req, res } = opts;
  // Get user from request if authenticated (set by auth middleware)
  let user = null;

  // Try to get user from request (if auth middleware ran)
  if (req.user) {
    user = req.user;
  } else {
    // Try to authenticate from token in headers
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

      if (token) {
        const decoded = verifyJWT(token);
        const prisma = await getPrisma();
        const dbUser = await prisma.user.findUnique({
          where: { id: decoded.sub },
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

        if (dbUser && dbUser.isActive) {
          user = {
            id: dbUser.id,
            email: dbUser.email,
            firstName: dbUser.firstName,
            lastName: dbUser.lastName,
            roles: dbUser.userRoles.map((ur) => ur.role),
          };
        }
      }
    } catch {
      // User is not authenticated - that's okay for public endpoints
      user = null;
    }
  }

  // Get Prisma client
  const prisma = await getPrisma();

  return {
    req,
    res,
    user,
    prisma,
  };
}

/**
 * Initialize tRPC
 * This creates the base tRPC instance with context
 */
const t = initTRPC.context().create();

/**
 * Base router - all routers should extend from this
 */
export const router = t.router;

/**
 * Public procedure - can be called without authentication
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure - requires authentication
 * Throws UNAUTHORIZED error if user is not authenticated
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to access this resource',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // TypeScript now knows user is defined
    },
  });
});

/**
 * Export the t instance for advanced use cases
 */
export { t };
