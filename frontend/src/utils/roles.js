/**
 * Role helpers shared by the shell (sidebar, routes, splash) and pages.
 *
 * Customer success accounts (csm, csm_lead) get their own small view: their
 * self-serve clients and Lone Wolves. Anyone who also holds an SE or admin
 * role keeps the full app. The backend enforces the same split
 * (middleware/rbac.js: blockCsm), so these only decide what is shown.
 */

export const CSM_ROLES = ['csm', 'csm_lead'];

const rolesOf = (user) => user?.roles || [];

/** A customer success account with no other role. */
export function isCsmOnly(user) {
  const roles = rolesOf(user);
  return roles.length > 0 && roles.every((role) => CSM_ROLES.includes(role));
}

export function isAdmin(user) {
  return rolesOf(user).includes('admin');
}

/** May edit Lone Wolves: admins and the CSM lead (the server answers `canEdit` too). */
export function canEditLoneWolves(user) {
  return isAdmin(user) || rolesOf(user).includes('csm_lead');
}

/** May switch a workspace's Old / New pricing: editors and every CSM (the server answers `canPrice` too). */
export function canPriceLoneWolves(user) {
  return canEditLoneWolves(user) || rolesOf(user).some((role) => CSM_ROLES.includes(role));
}

/** The roles an admin can give, in the order the user forms list them. */
export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales_engineer_lead', label: 'Sales Engineer Lead' },
  { value: 'sales_engineer_2', label: 'Sales Engineer 2' },
  { value: 'sales_engineer_1', label: 'Sales Engineer 1' },
  // Customer success: their self-serve clients and Lone Wolves only. The
  // lead also edits Lone Wolves. Neither takes a team.
  { value: 'csm_lead', label: 'CSM Lead' },
  { value: 'csm', label: 'CSM' },
];

/** Sees every self-serve client on the CSM dashboard, not only their own. */
export function seesAllClients(user) {
  return canEditLoneWolves(user);
}

/** The paths a CSM-only account may open; anything else goes home. */
export const CSM_PATHS = new Set(['/', '/change-password', '/projects/lone-wolves']);

/** The user's full name as a workspace's CSM field records it. */
export function fullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
}
