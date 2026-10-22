/**
 * Lone Wolves -- what the scan asks Task Wolf.
 *
 * Two questions, both through the Bone Pile's Task Wolf MCP client:
 *
 * - Which workspaces are self-serve: the customers on the SelfService QA team
 *   (ONBOARDING_QA_TEAM, by name), read from Task Wolf's own database.
 * - Whether a customer has started a run themselves: Task Wolf's recent
 *   suites say who started each one, and its customer_users table says who
 *   works at the customer. A run whose starter matches one of those names is
 *   the customer's; QA Wolf staff and unknown names prove nothing, so they
 *   leave the step unknown rather than "not yet".
 *
 * Read-only, like the rest of the page.
 */

export const QUERY_TOOL = 'query_task_wolf_db';
export const OVERVIEW_TOOL = 'get_customer_overview';

/** Task Wolf's days of recent suites to look back through for a customer run. */
const RUN_LOOKBACK_DAYS = 30;

/** QA Wolf ids are lower-case alphanumerics; anything else never reaches SQL. */
const SAFE_ID = /^[a-z0-9]+$/;

export function getOnboardingQaTeam(env = process.env) {
  return (env.ONBOARDING_QA_TEAM || 'SelfService').trim();
}

/** A SQL string literal for a value already known to be safe to quote. */
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

const rowsOf = (answer) => (Array.isArray(answer?.rows) ? answer.rows : []);

/**
 * The workspaces on the onboarding QA team, as `{ id, name, slug }`.
 * Deleted customers and Task Wolf's internal test customers are left out.
 */
export async function listTeamWorkspaces(client, team = getOnboardingQaTeam()) {
  const sql = `SELECT c."qawId", c."officialName", c.slug
    FROM "Customer" c JOIN qae_teams t ON t.id = c.qa_team_id
    WHERE t.name = ${literal(team)} AND c.deleted_at IS NULL AND c.is_internal_test = false
    ORDER BY c."officialName"`;
  const answer = await client.callTool(QUERY_TOOL, { sql, rowLimit: 500 });
  return rowsOf(answer)
    .filter((row) => SAFE_ID.test(row?.qawId || ''))
    .map((row) => ({ id: row.qawId, name: row.officialName, slug: row.slug || null }));
}

const normalizeName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Each workspace's customer-side people, as a set of normalized names. */
export async function customerPeople(client, workspaceIds) {
  const ids = workspaceIds.filter((id) => SAFE_ID.test(id));
  const people = new Map(ids.map((id) => [id, new Set()]));
  if (ids.length === 0) return people;
  const sql = `SELECT c."qawId", cu.full_name
    FROM customer_users cu JOIN "Customer" c ON c.id = cu.customer_id
    WHERE c."qawId" IN (${ids.map(literal).join(', ')})
      AND cu.active = true AND COALESCE(cu.is_bot, false) = false AND cu.full_name IS NOT NULL`;
  const answer = await client.callTool(QUERY_TOOL, { sql, rowLimit: 1000 });
  for (const row of rowsOf(answer)) {
    people.get(row.qawId)?.add(normalizeName(row.full_name));
  }
  return people;
}

/**
 * True when one of the workspace's recent suites was started by hand by
 * someone on the customer's side, else null (unknown).
 */
export function hasCustomerRun(overview, people) {
  const suites = Array.isArray(overview?.recentSuites?.suites) ? overview.recentSuites.suites : [];
  return suites.some(
    (suite) =>
      !suite?.triggerName && suite?.creatorName && people.has(normalizeName(suite.creatorName)),
  )
    ? true
    : null;
}

/** One workspace's customer-run answer; a failed lookup is unknown, not "no". */
export async function customerRunFor(client, workspaceId, people) {
  try {
    const overview = await client.callTool(OVERVIEW_TOOL, {
      customer: workspaceId,
      days: RUN_LOOKBACK_DAYS,
    });
    return hasCustomerRun(overview, people || new Set());
  } catch {
    return null;
  }
}
