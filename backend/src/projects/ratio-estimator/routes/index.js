import express from 'express';
import { openaiService } from '../../../services/openaiService.js';
import { splitArtifacts, validateArtifacts } from '../../../helpers.js';
import { PRIMARY_SYSTEM, PRIMARY_USER_PREFIX, POST_PROCESSOR } from '../../../prompts.js';

const router = express.Router();

// Ratio estimation endpoints
router.post('/estimate/initial', async (req, res) => {
  try {
    const { artifacts, context } = req.body;

    if (!artifacts || !Array.isArray(artifacts) || artifacts.length === 0) {
      return res.status(400).json({
        error: 'Artifacts array is required and must not be empty',
      });
    }

    // Business logic (moved from service)
    const validatedArtifacts = validateArtifacts(artifacts);
    const artifactChunks = splitArtifacts(validatedArtifacts);

    const results = [];
    for (const chunk of artifactChunks) {
      const userPrompt = `${PRIMARY_USER_PREFIX}${chunk.join('\n\n')}`;
      const response = await openaiService.callOpenAI(PRIMARY_SYSTEM, userPrompt);
      results.push(response);
    }

    res.json({
      success: true,
      results,
      totalChunks: artifactChunks.length,
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in initialEstimate:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

router.post('/estimate/postprocess', async (req, res) => {
  try {
    const { artifacts, context, initialEstimate } = req.body;

    if (!artifacts || !Array.isArray(artifacts) || artifacts.length === 0) {
      return res.status(400).json({
        error: 'Artifacts array is required and must not be empty',
      });
    }

    if (!initialEstimate) {
      return res.status(400).json({
        error: 'Initial estimate is required',
      });
    }

    // Business logic (moved from service)
    const validatedArtifacts = validateArtifacts(artifacts);
    const artifactChunks = splitArtifacts(validatedArtifacts);

    const results = [];
    for (const chunk of artifactChunks) {
      const userPrompt = `${PRIMARY_USER_PREFIX}${chunk.join('\n\n')}`;
      const initialResponse = await openaiService.callOpenAI(PRIMARY_SYSTEM, userPrompt);

      // Post-process the response
      const postProcessPrompt = `${POST_PROCESSOR}\n\nInitial Response: ${initialResponse}`;
      const postProcessedResponse = await openaiService.callOpenAI(
        PRIMARY_SYSTEM,
        postProcessPrompt,
      );

      results.push({
        initial: initialResponse,
        postProcessed: postProcessedResponse,
      });
    }

    res.json({
      success: true,
      results,
      totalChunks: artifactChunks.length,
      context: context || 'No context provided',
      initialEstimate,
    });
  } catch (error) {
    console.error('Error in postProcess:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

router.post('/estimate/fix-rejections', async (req, res) => {
  try {
    // This is a placeholder for future implementation
    res.status(501).json({
      error: 'Not implemented yet. This will fix rejected rows.',
    });
  } catch (error) {
    console.error('Error in fixRejections:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// Project info endpoint
router.get('/', (req, res) => {
  res.json({
    project: 'Ratio Estimator',
    description: 'AI-powered ratio estimation for sales engineering',
    version: '1.0.0',
    endpoints: {
      'initial-estimate': 'POST /api/ratio-estimator/estimate/initial',
      'post-process': 'POST /api/ratio-estimator/estimate/postprocess',
      'fix-rejections': 'POST /api/ratio-estimator/estimate/fix-rejections',
    },
  });
});

export default router;
