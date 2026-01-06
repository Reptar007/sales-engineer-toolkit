import express from 'express';
import { runnerService } from '../services/runnerService.js';
import { codeSummaryService } from '../services/codeSummaryServices.js';

const router = express.Router();

// Project info endpoint
router.get('/', (req, res) => {
  res.json({
    project: 'Code Summary & PDF Generator',
    description: 'Generate summaries of test code and create PDFs',
    version: '1.0.0',
    endpoints: {
      // Endpoints will be added here
    },
  });
});

// Fetch workflow from URL endpoint
router.post('/fetch-workflow', async (req, res) => {
  try {
    const { qawolfUrl } = req.body;

    // Validate input
    if (!qawolfUrl) {
      return res.status(400).json({ error: 'qawolfUrl is required' });
    }

    // Fetch workflow data
    const workflow = await runnerService.fetchWorkflowFromUrl(qawolfUrl);
    const workflowData = workflow.json;

    // Get Flow name
    const flowName = workflowData.workflow?.name || 'Unknown';

    // Get all steps and filter out "Node 20 Helpers"
    const allSteps = workflowData.stepsOnBranchInWorkflowOnBranch || [];
    const filteredSteps = allSteps.filter(
      (step) =>
        step.stepOnBranch?.name !== 'Node 20 Helpers' &&
        step.stepOnBranch?.name !== 'Mobile Helpers',
    );

    // Sort steps by their index to maintain workflow order
    const sortedSteps = filteredSteps.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    // Extract step data
    const steps = sortedSteps.map((step) => ({
      name: step.stepOnBranch?.name || 'Unnamed Step',
      code: step.stepOnBranch?.code || '',
      utility: step.stepOnBranch?.step?.isUtility || false,
    }));

    res.json({
      flowName,
      steps,
      totalSteps: steps.length,
    });
  } catch (error) {
    // Handle different error types
    if (error.message.includes('Invalid URL') || error.message.includes('Could not find')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Generate summary endpoint
router.post('/generate-summary', async (req, res) => {
  try {
    const { flowName, code } = req.body;

    // Validate input
    if (!flowName) {
      return res.status(400).json({ error: 'flowName is required' });
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ error: 'code is required and must be a non-empty string' });
    }

    // Generate summary using OpenAI
    const summary = await codeSummaryService.generateCodeSummary(flowName, code);

    res.json({
      success: true,
      flowName,
      summary,
      codeLength: code.length,
    });
  } catch (error) {
    console.error('Error generating summary:', error);

    // Handle OpenAI-specific errors
    if (error.message.includes('OpenAI API')) {
      return res.status(500).json({
        error: 'Failed to generate summary. Please check OpenAI API configuration.',
        details: error.message,
      });
    }

    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
