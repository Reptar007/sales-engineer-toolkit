/**
 * Universal tRPC Functions
 * Reusable functions for making tRPC calls to external APIs
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve1PasswordValue } from './resolve1Password.js';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
// Try root .env file (backend/src/functions/ -> ../../../ -> root)
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config(); // Also load from process.env and default .env location

// Universal variables - resolve 1Password references
const BASE_URL = resolve1PasswordValue(process.env.QAW_BASE_URL);
const TOKEN = resolve1PasswordValue(process.env.QAW_BEARER_TOKEN);

/**
 * Validate that required environment variables are set
 * @returns {Object} Validation result with status and missing variables
 */
export function validateEnvVars() {
  const missing = [];

  if (!BASE_URL) {
    missing.push('QAW_BASE_URL');
  }

  if (!TOKEN) {
    missing.push('QAW_BEARER_TOKEN');
  }

  return {
    valid: missing.length === 0,
    missing,
    baseUrl: BASE_URL ? `${BASE_URL.substring(0, 30)}...` : null,
    hasToken: !!TOKEN,
  };
}

/**
 * Initial function - makes tRPC GET request to external API
 * @param {string} procedurePath - tRPC procedure path (e.g., 'workflowOnBranch.getManyGroupedIncludingWorkflow')
 * @param {Object} input - Input data to send (will be JSON encoded in query param)
 * @param {Object} options - Additional options
 * @param {string} options.baseUrl - Optional base URL (defaults to QAW_BASE_URL env var)
 * @param {string} options.token - Optional bearer token (defaults to QAW_BEARER_TOKEN env var)
 * @returns {Promise<Object>} Response from tRPC endpoint
 */
export async function initial(procedurePath, input = {}, options = {}) {
  // Use provided baseUrl or fall back to environment variable
  let baseUrl = options.baseUrl || BASE_URL;
  if (!baseUrl) {
    throw new Error(
      'baseUrl is required. Either provide it in options.baseUrl or set QAW_BASE_URL environment variable.',
    );
  }

  if (!procedurePath) {
    throw new Error('procedurePath is required');
  }

  // Use provided token or fall back to environment variable
  const token = options.token || TOKEN;

  // Normalize baseUrl - remove /api/trpc if it's already in the URL
  if (baseUrl.endsWith('/api/trpc')) {
    baseUrl = baseUrl.replace('/api/trpc', '');
  } else if (baseUrl.endsWith('/api/trpc/')) {
    baseUrl = baseUrl.replace('/api/trpc/', '');
  }

  // Build the URL
  const url = new URL(`/api/trpc/${procedurePath}`, baseUrl);

  // Encode input as JSON and add to query params
  const inputJson = JSON.stringify({ json: input });
  url.searchParams.set('input', inputJson);

  // Build headers
  const headers = {
    'Content-Type': 'application/json',
  };

  // Add authorization token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `tRPC request failed: ${response.status} ${response.statusText}. ${errorText}`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error in initial tRPC call:', error);
    throw new Error(`Failed to call tRPC endpoint: ${error.message}`);
  }
}
