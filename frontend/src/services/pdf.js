/**
 * @typedef {Object} Step
 * @property {string} id - Step ID
 * @property {string} name - Step name
 * @property {string} type - Step type
 * @property {Object} [config] - Step configuration
 * @property {string} createdAt - Creation timestamp
 * @property {string} updatedAt - Update timestamp
 */

/**
 * @typedef {Object} StepOnBranch
 * @property {string} id - Step on branch ID
 * @property {string} stepId - Reference to step ID
 * @property {string} branchId - Reference to branch ID
 * @property {number} order - Step order in the branch
 * @property {Step} step - Step details
 */

/**
 * @typedef {Object} StepsOnBranchInWorkflowOnBranch
 * @property {string} id - Steps on branch in workflow ID
 * @property {string} workflowOnBranchId - Workflow on branch ID
 * @property {string} stepOnBranchId - Step on branch ID
 * @property {StepOnBranch} stepOnBranch - Step on branch details
 */

/**
 * @typedef {Object} WorkflowData
 * @property {string} id - Workflow ID
 * @property {string} name - Workflow name
 * @property {string} environmentId - Environment ID
 * @property {string} workflowId - Base workflow ID
 * @property {string} createdAt - Creation timestamp
 * @property {string} updatedAt - Update timestamp
 * @property {StepsOnBranchInWorkflowOnBranch[]} stepsOnBranchInWorkflowOnBranch - Workflow steps
 */

/**
 * Fetches workflow data with steps using our backend API
 * @param {Object} params - Query parameters
 * @param {string} params.environmentId - Environment ID to filter by
 * @param {string} params.workflowId - Workflow ID to filter by
 * @returns {Promise<WorkflowData[]>} Array of workflow data
 */
export const useGetWorkflowQuery = async ({ environmentId, workflowId, inputObj }) => {
  const response = await fetch('/api/workflow', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      environmentId,
      workflowId,
      inputObj, // Pass the complete input object structure
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  return result.data;
};
