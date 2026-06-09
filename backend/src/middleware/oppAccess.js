import { getPrisma } from '../lib/prisma.js';

/**
 * Returns true iff the user is allowed to mutate the given Opp:
 *   - the owning SE (matched via SalesEngineer.userId)
 *   - any user with the `sales_engineer_lead` role
 *   - any user with the `admin` role
 *
 * @param {{ id: string, roles?: string[] }} user
 * @param {{ salesEngineer: { userId: string } }} opp
 * @returns {boolean}
 */
export function canEditOpp(user, opp) {
  if (!user || !opp) return false;
  const roles = user.roles || [];
  if (roles.includes('admin') || roles.includes('sales_engineer_lead')) return true;
  return opp.salesEngineer?.userId === user.id;
}

/**
 * Express middleware that loads `req.params.id` as an Opp (with its SE
 * relation), attaches it to `req.opp`, and 403s when the requester can't
 * edit it. Used by PATCH / DELETE /opps/:id.
 */
export async function requireOppEdit(req, res, next) {
  try {
    const prisma = await getPrisma();
    const opp = await prisma.opp.findUnique({
      where: { id: req.params.id },
      include: { salesEngineer: { include: { user: true } } },
    });
    if (!opp) {
      return res.status(404).json({ error: 'Opp not found' });
    }
    if (!canEditOpp(req.user, opp)) {
      return res.status(403).json({
        error: 'Only the owning SE or a Lead can edit this Opp.',
      });
    }
    req.opp = opp;
    next();
  } catch (err) {
    console.error('requireOppEdit failed:', err);
    return res.status(500).json({ error: 'Failed to load opp' });
  }
}
