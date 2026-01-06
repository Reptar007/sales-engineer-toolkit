import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../../.env') }); // backend/.env
dotenv.config({ path: resolve(__dirname, '../../../../../.env') }); // root .env
dotenv.config();

// Get QA Wolf authentication token from environment
const QAWOLF_AUTH_TOKEN = process.env.QAW_BEARER_TOKEN;

// Base URL for QA Wolf tRPC API
const QAWOLF_TRPC_BASE_URL = 'https://app.qawolf.com/api/trpc';

/**
 * Parse QA Wolf URL to extract environmentId and workflowId
 * @param {string} url - Full QA Wolf URL
 * @returns {{environmentId: string, workflowId: string}}
 * @throws {Error} If URL is invalid or IDs cannot be extracted
 */
const parseQawolfUrl = (url) => {
  // Validate URL format
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Validate it's a QA Wolf URL
  if (urlObj.hostname !== 'app.qawolf.com') {
    throw new Error('URL must be from app.qawolf.com');
  }

  // Extract environmentId from pathname
  const environmentMatch = urlObj.pathname.match(/\/environments\/([^/]+)\//);
  if (!environmentMatch || !environmentMatch[1]) {
    throw new Error(
      'Could not find environmentId in URL. Expected format: /environments/{environmentId}/',
    );
  }
  const environmentId = environmentMatch[1];

  // Extract workflowId from pathname (handle with or without trailing slash)
  const workflowMatch = urlObj.pathname.match(/\/flows\/([^/]+)/);
  if (!workflowMatch || !workflowMatch[1]) {
    throw new Error('Could not find workflowId in URL. Expected format: /flows/{workflowId}');
  }
  const workflowId = workflowMatch[1];

  return {
    environmentId,
    workflowId,
  };
};

/**
 * Create a tRPC client for QA Wolf API with authentication
 * @returns {Object} Configured tRPC proxy client
 * @throws {Error} If authentication token is not configured
 */
function createQawolfClient() {
  if (!QAWOLF_AUTH_TOKEN) {
    throw new Error(
      'QA Wolf authentication token not configured. Please set QAW_BEARER_TOKEN environment variable.',
    );
  }

  return createTRPCProxyClient({
    links: [
      httpBatchLink({
        url: QAWOLF_TRPC_BASE_URL,
        headers: () => ({
          Authorization: `Bearer ${QAWOLF_AUTH_TOKEN}`,
        }),
      }),
    ],
  });
}

/**
 * Fetch workflow data from QA Wolf runner
 * @param {string} qawolfUrl - Full QA Wolf URL
 * @returns {Promise<{workflowName: string, steps: Array, metadata: Object}>}
 * @throws {Error} If URL is invalid, connection fails, or data is missing
 */
async function fetchWorkflowFromUrl(qawolfUrl) {
  // Parse the URL to get the environmentId and workflowId
  const { environmentId, workflowId } = parseQawolfUrl(qawolfUrl);

  // Create a tRPC client for QA Wolf API
  const client = createQawolfClient();

  // Prepare the query - matching the exact working format from the URL
  const queryParams = {
    filter: {
      environmentId,
      workflowId,
    },
    include: {
      activeReproduction: {
        issue: true,
      },
      executionTarget: true,
      runnerConfig: true,
      stepsOnBranchInWorkflowOnBranch: {
        stepOnBranch: {
          code: true,
          name: true,
          step: true,
        },
      },
      workflow: {
        coverageRequestIssues: true,
        group: true,
        tags: true,
        name: true,
      },
    },
  };

  // Fetch the workflow data using the client
  const data = await client.workflowOnBranch.findByWorkflowIdAndEnvironment.query(queryParams);

  return data;
}

export const runnerService = {
  fetchWorkflowFromUrl,
};
