/**
 * API service layer for communicating with the backend
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Generic fetch wrapper with error handling
 * Automatically includes auth token in all requests if available
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  // Get auth token from localStorage
  const token = localStorage.getItem('authToken');

  // Build headers - add auth token if available
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add Authorization header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    headers,
    ...options,
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API Request failed for ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Convert CSV file to text and send to backend for initial processing
 * @param {File} csvFile - The uploaded CSV file
 * @returns {Promise<Object>} Response with processed data from ChatGPT
 */
export async function processCSVWithChatGPT(csvFile) {
  if (!csvFile) {
    throw new Error('No CSV file provided');
  }

  // Read the CSV file content
  const csvText = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read CSV file'));
    reader.readAsText(csvFile);
  });

  // Send CSV content to backend for processing
  return apiRequest('/estimate/initial', {
    method: 'POST',
    body: JSON.stringify({
      inputText: csvText,
    }),
  });
}

/**
 * Send CSV data to backend for post-processing
 * @param {string} csvData - CSV data as string
 * @returns {Promise<Object>} Response with processed CSV
 */
export async function postProcessCSV(csvData) {
  return apiRequest('/estimate/postprocess', {
    method: 'POST',
    body: JSON.stringify({
      csv: csvData,
    }),
  });
}

/**
 * Send rejection fixes to backend
 * @param {Array} rejectedItems - Array of rejected items with fixes
 * @returns {Promise<Object>} Response with fixed items
 */
export async function fixRejections(rejectedItems) {
  return apiRequest('/estimate/fix-rejections', {
    method: 'POST',
    body: JSON.stringify({
      rejectedItems,
    }),
  });
}

/**
 * Check backend health
 * @returns {Promise<Object>} Health status
 */
export async function checkHealth() {
  return apiRequest('/healthz');
}

/**
 * Fetch Salesforce report data
 * @param {string} reportId - Salesforce report ID
 * @returns {Promise<Object>} Report data from Salesforce
 */
export async function fetchSalesforceReport(reportId) {
  return apiRequest(`/salesforce/report/${reportId}`);
}

/**
 * Check Salesforce API health
 * @returns {Promise<Object>} Salesforce API health status
 */
export async function checkSalesforceHealth() {
  return apiRequest('/salesforce/health');
}

/**
 * Fetch users
 * @returns {Promise<Object>} Users
 */
export async function fetchUsers() {
  return apiRequest('/users');
}

/**
 * Fetch users with a Sales Engineer role who don't yet have a team.
 * Used by admin TeamsPage "Attach SE" picker.
 */
export async function fetchUsersWithoutTeam() {
  return apiRequest('/users/without-team');
}

/**
 * Admin: create a new user without disturbing the current admin session.
 *
 * Unlike AuthProvider.register (which logs the admin in as the new user as a
 * side effect), this hits /auth/register through apiRequest and just returns
 * the response — the caller is responsible for surfacing the temporary
 * password back to the admin.
 *
 * @param {{
 *   email: string,
 *   firstName: string,
 *   lastName: string,
 *   roles?: string[],
 *   password?: string,        // when omitted, server generates a random one
 *   teamId?: string,          // attach to an existing team
 *   teamName?: string,        // OR create a brand new team for this user
 *   teamDescription?: string,
 * }} payload
 */
export async function createUser(payload) {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Admin: update a user's profile fields. `salesforceEmail` is only honored
 * when the target user has a SalesEngineer record; pass an empty string to
 * clear it on the SalesEngineer side without touching the rest.
 * @param {string} userId
 * @param {{ firstName?: string, lastName?: string, email?: string, salesforceEmail?: string }} patch
 */
export async function updateUser(userId, patch) {
  return apiRequest(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Admin: reset a user's password back to the seed default. Returns the
 * temporary password so the admin UI can display it to the operator —
 * the user will be forced through the change-password screen on next login.
 */
export async function resetUserPassword(userId) {
  return apiRequest(`/users/${userId}/reset-password`, {
    method: 'POST',
  });
}

/** Admin: list all teams (active + inactive) with their SE and active AEs. */
export async function fetchTeams() {
  return apiRequest('/teams');
}

/** Admin: create a new team. Optional `userId` attaches an existing SE. */
export async function createTeam({ name, description, userId } = {}) {
  return apiRequest('/teams', {
    method: 'POST',
    body: JSON.stringify({ name, description, userId }),
  });
}

/** Admin: rename / re-describe / toggle isActive for a team. */
export async function updateTeam(teamId, patch) {
  return apiRequest(`/teams/${teamId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Admin: attach an existing SE-role user to a team that has no SE yet. */
export async function attachSEToTeam(teamId, { userId, salesforceEmail } = {}) {
  return apiRequest(`/teams/${teamId}/se`, {
    method: 'POST',
    body: JSON.stringify({ userId, salesforceEmail }),
  });
}

/** Admin: add a new AE to a team. */
export async function createAE(teamId, { name, salesforceId, salesforceEmail } = {}) {
  return apiRequest(`/teams/${teamId}/aes`, {
    method: 'POST',
    body: JSON.stringify({ name, salesforceId, salesforceEmail }),
  });
}

/** Admin: rename, re-email, or move an AE to another team. */
export async function updateAE(teamId, aeId, patch) {
  return apiRequest(`/teams/${teamId}/aes/${aeId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Admin: soft-delete an AE (also deactivates matching TeamAssignment rows). */
export async function deleteAE(teamId, aeId) {
  return apiRequest(`/teams/${teamId}/aes/${aeId}`, {
    method: 'DELETE',
  });
}

/**
 * Search opportunities in Salesforce
 * @param {string} search - Search term
 * @returns {Promise<Object>} Opportunities
 */
export async function searchOpportunities(search) {
  return apiRequest(`/salesforce/opportunity/search?search=${search}`);
}

/**
 * Fetch Gong conversations for an opportunity
 * @param {string} opportunityId - Opportunity ID
 * @returns {Promise<Object>} Gong conversations
 */
export async function fetchGongConversations(opportunityId) {
  return apiRequest(`/salesforce/opportunity/${opportunityId}/gong-conversations`);
}

/**
 * Fetches the central Salesforce config (report IDs by year, goals by year, snapshot years).
 * @returns {Promise<{ reportIdsByYear: Object, goalsByYear: Object, snapshotYears: number[] }>} Config used by metrics, calculator, and snapshot UI.
 */
export async function getSalesforceConfig() {
  return apiRequest(`/salesforce/config`);
}

/**
 * Fetches metrics payload for a snapshot year (same shape as metrics report).
 * @param {number} year - Year (e.g. 2025).
 * @returns {Promise<Object>} Metrics report-shaped data.
 */
export async function fetchSalesforceSnapshotMetrics(year) {
  return apiRequest(`/salesforce/snapshot/${year}`);
}

/**
 * Fetches calculator payload for a snapshot year (same shape as calculator report).
 * @param {number} year - Year (e.g. 2025).
 * @returns {Promise<Object>} Calculator report-shaped data.
 */
export async function fetchSalesforceSnapshotCalculator(year) {
  return apiRequest(`/salesforce/snapshot/${year}/calculator`);
}

/**
 * Creates snapshot JSON files for a given year by fetching both reports from Salesforce and writing them to disk.
 * Admin-only; requires backend POST /salesforce/snapshot/:year.
 * @param {number} year - Year to snapshot (e.g. 2025, 2026).
 * @returns {Promise<Object>} Success payload (e.g. summary of created files).
 */
export async function createSnapshot(year) {
  return apiRequest(`/salesforce/snapshot/${year}`, { method: 'POST' });
}

/**
 * Fetches quarterly goals for a single year (admin-only).
 * @param {number} year - Year (e.g. 2026).
 * @returns {Promise<{ year: number, goals: Array<{ value: number, label: string, goal: number }> }>}
 */
export async function getQuarterlyGoals(year) {
  return apiRequest(`/salesforce/goals/${year}`);
}

/**
 * Saves quarterly goals for a single year (admin-only).
 * @param {number} year - Year (e.g. 2026).
 * @param {Array<{ quarter: number, goal: number }>} goals - Four quarter goal entries.
 * @returns {Promise<{ success: boolean, year: number, goals: Array<{ value: number, label: string, goal: number }> }>}
 */
export async function updateQuarterlyGoals(year, goals) {
  return apiRequest(`/salesforce/goals/${year}`, {
    method: 'PUT',
    body: JSON.stringify({ goals }),
  });
}

/** Dashboard: today’s calendar events (Google Calendar when configured). */
export async function fetchDashboardCalendar() {
  return apiRequest('/dashboard/calendar');
}

/** Dashboard: Linear workload grouped by AE / Creations / CSM projects. */
export async function fetchDashboardLinear() {
  return apiRequest('/dashboard/linear');
}

/**
 * Team page: per-user closed-ticket roll-up for a calendar year, grouped
 * by quarter and by category (estimation / creation / other). Defaults
 * to the current calendar year on the backend when `year` is omitted.
 * @param {number} [year]
 */
export async function fetchDashboardLinearClosed(year) {
  const query = Number.isInteger(year) ? `?year=${year}` : '';
  return apiRequest(`/dashboard/linear/closed${query}`);
}

/**
 * Team page: tickets-created-by-AE roll-up for a calendar year. Returns
 * a `byAE` map keyed by normalized AE name (lowercase + trim) so the
 * team page can match against `team.accountExecutives` directly.
 * Defaults to the current calendar year on the backend when `year` is
 * omitted.
 * @param {number} [year]
 */
export async function fetchDashboardLinearTicketsByAE(year) {
  const query = Number.isInteger(year) ? `?year=${year}` : '';
  return apiRequest(`/dashboard/linear/tickets-by-ae${query}`);
}

/**
 * Team page (lead Pack view): per-SE closed-ticket roll-up for every
 * active Sales Engineer, plus each SE's assigned AE roster names so the
 * frontend can pair them with the Salesforce metrics to derive closed
 * CARR. Admin / SE-lead only on the backend; throws on 403 for other
 * callers so the UI can hide the Pack toggle. Defaults to the current
 * calendar year on the backend when `year` is omitted.
 * @param {number} [year]
 */
export async function fetchPackOverview(year) {
  const query = Number.isInteger(year) ? `?year=${year}` : '';
  return apiRequest(`/dashboard/pack-overview${query}`);
}

/**
 * Per-SE Closed CARR roll-up for the pack (attributed via handoff pages).
 * Powers the team-page "Closed CARR by SE" breakdown. Lead/admin only.
 */
export async function fetchPackCarr(year) {
  const query = Number.isInteger(year) ? `?year=${year}` : '';
  return apiRequest(`/dashboard/pack-carr${query}`);
}

/**
 * Actual Linear tickets for one SE in the pack (open workload + closed
 * this year). Powers the team-page drill-down. Lead/admin only.
 */
export async function fetchPackSeTickets(seId, year) {
  const query = Number.isInteger(year) ? `?year=${year}` : '';
  return apiRequest(`/dashboard/pack-overview/${encodeURIComponent(seId)}/tickets${query}`);
}

/**
 * Today's Google Calendar for one SE in the pack. Powers the team-page
 * drill-down calendar. `configured: false` means the SE hasn't connected
 * their Google account. Lead/admin only.
 */
export async function fetchPackSeCalendar(seId) {
  return apiRequest(`/dashboard/pack-overview/${encodeURIComponent(seId)}/calendar`);
}

/** Google Calendar OAuth: returns { authorizationUrl }. */
export async function startGoogleCalendarOAuth() {
  return apiRequest('/integrations/google/start', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Remove stored Google Calendar tokens for the current user. */
export async function disconnectGoogleCalendar() {
  return apiRequest('/integrations/google', { method: 'DELETE' });
}

/**
 * Load the current user's Linear profile link state.
 * @returns {Promise<{
 *   hasSalesEngineer: boolean,
 *   linearUserId: string | null,
 *   linearUser: { id: string, email: string, name: string } | null,
 *   appEmail: string,
 *   autoResolvable: boolean,
 * }>}
 */
export async function getLinearProfile() {
  return apiRequest('/users/me/linear');
}

/**
 * Link the current user to a Linear account. Provide exactly one of email or userId.
 * @param {{ linearEmail?: string, linearUserId?: string }} body
 */
export async function saveLinearProfile(body) {
  return apiRequest('/users/me/linear', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** Clear the current user's stored SalesEngineer.linearUserId. */
export async function disconnectLinearProfile() {
  return apiRequest('/users/me/linear', { method: 'DELETE' });
}

// --- Opps (handoff pages) ----------------------------------------------------

/**
 * List the team-wide Opp directory.
 * @param {{ search?: string, seId?: string, includeArchived?: boolean }} [params]
 */
export async function listOpps(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.seId) query.set('seId', params.seId);
  if (params.includeArchived) query.set('includeArchived', '1');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/opps${suffix}`);
}

/** Fetch the current SE's Linear-derived + DB-saved opps. */
export async function listMyOpps() {
  return apiRequest('/opps/mine');
}

/** Fetch a single Opp with linked Linear tickets + canEdit flag. */
export async function getOpp(id) {
  return apiRequest(`/opps/${id}`);
}

/**
 * Create or upsert an Opp by (current SE, oppName).
 * @param {{ oppName: string, salesforceOpportunityId?: string|null, salesEngineerId?: string }} body
 */
export async function createOpp(body) {
  return apiRequest('/opps', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
}

/** Partial update of editable Opp fields. Throws on 403 for non-owners. */
export async function updateOpp(id, patch) {
  return apiRequest(`/opps/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  });
}

/**
 * Hard-delete an Opp. Backend gates this to the owning SE or an admin
 * (Leads can edit-on-behalf but can't delete). Throws on 403 for anyone
 * else, 404 if the Opp is already gone.
 */
export async function deleteOpp(id) {
  return apiRequest(`/opps/${id}`, { method: 'DELETE' });
}

/**
 * List the caller's currently-open Linear tickets for the manual-link
 * picker on the Opp detail page. Returns `{ configured, tickets }` --
 * the picker hides itself when Linear isn't wired up.
 */
export async function listMyLinearTickets() {
  return apiRequest('/opps/linear/my-tickets');
}

/**
 * Manually link a Linear ticket to an Opp. `input` can be either a bare
 * identifier ("AXO-959") or a full Linear URL -- the backend parses both.
 * Throws on 404 when the ticket doesn't exist in the configured team and
 * 403 for non-editors.
 */
export async function linkLinearTicket(id, input) {
  return apiRequest(`/opps/${id}/linear-links`, {
    method: 'POST',
    body: JSON.stringify({ identifier: input }),
  });
}

/** Remove a manual link by identifier. Auto-discovered tickets are unaffected. */
export async function unlinkLinearTicket(id, identifier) {
  return apiRequest(`/opps/${id}/linear-links/${encodeURIComponent(identifier)}`, {
    method: 'DELETE',
  });
}

/**
 * List active Sales Engineers for the reassignment picker on the Opp
 * detail page. Admin/Lead only on the backend; throws on 403 for other
 * callers so the UI can hide the picker.
 */
export async function listSalesEngineersForOpps() {
  return apiRequest('/opps/sales-engineers');
}

/**
 * Push the Opp to Notion as a database page. Pass the SF + Gong data the
 * detail page already has loaded so the server doesn't re-query SF; the
 * backend trusts the caller (same auth gate as PATCH).
 *
 * @param {string} id
 * @param {{ sfData?: object|null, gongConversations?: Array, linearTickets?: object|null }} payload
 */
export async function sendOppToNotion(id, payload = {}) {
  return apiRequest(`/opps/${id}/notion`, {
    method: 'POST',
    body: JSON.stringify({
      sfData: payload.sfData || null,
      gongConversations: payload.gongConversations || [],
      // We forward the linked Linear tickets from the detail page so the
      // Notion handoff section can surface AE-template metadata (Slack
      // thread, "Type of Ask") without a redundant Linear round-trip on
      // the backend. Pass null/omit to fall back to whatever the backend
      // had cached.
      linearTickets: payload.linearTickets || null,
    }),
  });
}

/**
 * Ask Claude to mine the opp's Gong call briefs for handoff suggestions
 * (Integrations / Pain Points / Additional Notes). We forward the Gong
 * conversations the detail page already loaded so the server doesn't
 * re-query Salesforce. Returns { suggestions, callsAnalyzed } or
 * { suggestions: null, reason } when there's nothing to analyze.
 *
 * @param {string} id
 * @param {{ gongConversations?: Array }} payload
 */
export async function analyzeOppGong(id, payload = {}) {
  return apiRequest(`/opps/${id}/analyze-gong`, {
    method: 'POST',
    body: JSON.stringify({
      gongConversations: payload.gongConversations || [],
    }),
  });
}

// Export apiRequest for direct use
export { apiRequest };

export default {
  processCSVWithChatGPT,
  postProcessCSV,
  fixRejections,
  checkHealth,
  fetchSalesforceReport,
  fetchSalesforceSnapshotMetrics,
  fetchSalesforceSnapshotCalculator,
  getSalesforceConfig,
  createSnapshot,
  getQuarterlyGoals,
  updateQuarterlyGoals,
  checkSalesforceHealth,
  fetchDashboardCalendar,
  fetchDashboardLinear,
  startGoogleCalendarOAuth,
  disconnectGoogleCalendar,
  getLinearProfile,
  saveLinearProfile,
  disconnectLinearProfile,
  fetchUsers,
  searchOpportunities,
  fetchGongConversations,
  listOpps,
  listMyOpps,
  getOpp,
  createOpp,
  updateOpp,
  deleteOpp,
  listSalesEngineersForOpps,
  listMyLinearTickets,
  linkLinearTicket,
  unlinkLinearTicket,
  sendOppToNotion,
};
