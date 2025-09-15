import express from 'express';
import multer from 'multer';
import { openaiService } from '../../../services/openaiService.js';
import { splitArtifacts, validateArtifacts } from '../../../helpers.js';
import {
  PRIMARY_SYSTEM,
  PRIMARY_USER_PREFIX,
  POST_PROCESSOR,
  CSV_ANALYSIS_SYSTEM,
  CSV_ANALYSIS_USER_PREFIX,
} from '../../../prompts.js';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Accept CSV files
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

const router = express.Router();

// CSV Analysis endpoint (First Pass)
router.post('/analyze-csv', upload.single('csvFile'), async (req, res) => {
  try {
    // Check if this is a file upload (multipart/form-data) or JSON body
    let csvContent, context;

    if (req.file) {
      // Handle file upload
      csvContent = req.file.buffer.toString('utf-8');
      context = req.body.context || '';
    } else {
      // Handle JSON body (for backward compatibility)
      ({ csvContent, context } = req.body);
    }

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({
        error:
          'CSV content is required. Please upload a CSV file or provide csvContent in the request body.',
      });
    }

    if (csvContent.trim().length === 0) {
      return res.status(400).json({
        error: 'CSV content cannot be empty',
      });
    }

    // Analyze the CSV structure and content
    const userPrompt = `${CSV_ANALYSIS_USER_PREFIX}${csvContent}`;
    const analysisResponse = await openaiService.callOpenAI(CSV_ANALYSIS_SYSTEM, userPrompt);

    // Try to parse the JSON response
    let analysis;
    try {
      // Remove markdown code blocks if present
      let jsonString = analysisResponse;
      if (jsonString.includes('```json')) {
        jsonString = jsonString.replace(/```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonString.includes('```')) {
        jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
      }

      analysis = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse analysis JSON:', parseError);
      return res.status(500).json({
        error: 'Failed to parse analysis response from AI service',
        rawResponse: analysisResponse,
      });
    }

    res.json({
      success: true,
      analysis,
      context: context || 'No context provided',
      rawResponse: analysisResponse, // Include raw response for debugging
    });
  } catch (error) {
    console.error('Error in analyzeCsv:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

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
      'analyze-csv': 'POST /api/ratio-estimator/analyze-csv',
      'initial-estimate': 'POST /api/ratio-estimator/estimate/initial',
      'post-process': 'POST /api/ratio-estimator/estimate/postprocess',
      'fix-rejections': 'POST /api/ratio-estimator/estimate/fix-rejections',
    },
  });
});

export default router;
