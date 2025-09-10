/**
 * API service layer for communicating with the backend
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Generic fetch wrapper with error handling
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
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

export default {
  processCSVWithChatGPT,
  postProcessCSV,
  fixRejections,
  checkHealth,
};
