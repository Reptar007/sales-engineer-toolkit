/**
 * Build a URL-safe slug from a team name.
 *
 * Used in two places that must agree:
 *   - the sidebar link the SE clicks ("Team Mario" -> /teams/team-mario)
 *   - the route guard inside the team page that compares the URL slug to
 *     the current user's own team
 *
 * Keep it dumb on purpose: lowercase, collapse non-alphanumerics to `-`,
 * trim leading/trailing dashes. We do NOT try to handle collisions —
 * scope is "own team only" so the slug is cosmetic and the page always
 * renders the logged-in SE's team regardless of what's in the URL.
 */
export function toTeamSlug(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
