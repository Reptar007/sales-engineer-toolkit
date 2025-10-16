/**
 * Ratio Estimator specific API services
 * Handles CSV processing and ratio estimation endpoints
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Process CSV file with ChatGPT for ratio estimation
 */
export async function processCSVWithChatGPT(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/ratio-estimator/process`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Fix rejected tests by resubmitting to ChatGPT
 */
export async function fixRejections(rejectedTests) {
  const response = await fetch(`${API_BASE_URL}/ratio-estimator/fix-rejections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rejectedTests }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Get ratio estimator configuration
 */
export async function getRatioEstimatorConfig() {
  const response = await fetch(`${API_BASE_URL}/ratio-estimator/config`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}
