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
  fetchUsers,
  searchOpportunities,
  fetchGongConversations,
};
