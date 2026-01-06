import { apiRequest } from '../../../services/api.js';

/**
 * Fetch workflow steps from QA Wolf URL
 * @param {string} qawolfUrl - Full QA Wolf URL
 * @returns {Promise<Object>} Workflow steps data
 */
export async function fetchWorkflowFromUrl(qawolfUrl) {
  return apiRequest('/code-summary-pdf/fetch-workflow', {
    method: 'POST',
    body: JSON.stringify({ qawolfUrl }),
  });
}

/**
 * Generate a summary of test code using OpenAI
 * @param {string} flowName - The name of the flow
 * @param {string} code - The combined code from selected tests
 * @returns {Promise<Object>} Summary data with flowName, summary, and codeLength
 */
export async function generateSummary(flowName, code) {
  return apiRequest('/code-summary-pdf/generate-summary', {
    method: 'POST',
    body: JSON.stringify({ flowName, code }),
  });
}
