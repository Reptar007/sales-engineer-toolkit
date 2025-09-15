import express from 'express';
import multer from 'multer';
import { openaiService } from '../../../services/openaiService.js';
import { learningService } from '../../../services/learningService.js';
import { splitArtifacts, validateArtifacts } from '../../../helpers.js';
import {
  PRIMARY_SYSTEM,
  PRIMARY_USER_PREFIX,
  POST_PROCESSOR,
  CSV_ANALYSIS_SYSTEM,
  CSV_ANALYSIS_USER_PREFIX,
  CSV_PREPARATION_SYSTEM,
  CSV_PREPARATION_USER_PREFIX,
  CONTEXT_NORMALIZATION_SYSTEM,
  CONTEXT_NORMALIZATION_USER_PREFIX,
  AAA_CONVERSION_SYSTEM,
  AAA_CONVERSION_USER_PREFIX,
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

    // Pre-analyze CSV structure for consistent counting
    const lines = csvContent.trim().split('\n');
    const totalLines = lines.length;
    const hasHeader = totalLines > 0;
    const dataRows = hasHeader ? totalLines - 1 : totalLines;

    // Detect delimiter
    const firstLine = lines[0] || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;

    let delimiter = 'comma';
    if (semicolonCount > commaCount && semicolonCount > tabCount) delimiter = 'semicolon';
    else if (tabCount > commaCount && tabCount > semicolonCount) delimiter = 'tab';

    const totalColumns =
      delimiter === 'comma'
        ? commaCount + 1
        : delimiter === 'semicolon'
          ? semicolonCount + 1
          : delimiter === 'tab'
            ? tabCount + 1
            : 1;

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

      // Override structure with our consistent calculations
      analysis.structure = {
        totalRows: dataRows, // Only count data rows, not header
        totalColumns,
        hasHeader,
        delimiter,
        encoding: 'utf-8',
      };
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
    });
  } catch (error) {
    console.error('Error in analyzeCsv:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// CSV Preparation endpoint (Third Buffer)
router.post('/prepare-csv', upload.single('csvFile'), async (req, res) => {
  try {
    // Check if this is a file upload (multipart/form-data) or JSON body
    let csvContent, analysis, normalization, context;

    if (req.file) {
      // Handle file upload
      csvContent = req.file.buffer.toString('utf-8');
      analysis = JSON.parse(req.body.analysis || '{}');
      normalization = JSON.parse(req.body.normalization || '{}');
      context = req.body.context || '';
    } else {
      // Handle JSON body (for backward compatibility)
      ({ csvContent, analysis, normalization, context } = req.body);
    }

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({
        error:
          'CSV content is required. Please upload a CSV file or provide csvContent in the request body.',
      });
    }

    if (!analysis || typeof analysis !== 'object') {
      return res.status(400).json({
        error:
          'Analysis results are required. Please provide the analysis from the /analyze-csv endpoint.',
      });
    }

    // Normalization is optional - if not provided, use empty object
    if (!normalization || typeof normalization !== 'object') {
      normalization = {};
    }

    if (csvContent.trim().length === 0) {
      return res.status(400).json({
        error: 'CSV content cannot be empty',
      });
    }

    // Parse CSV to get row count and split into chunks
    const csvLines = csvContent.split('\n').filter((line) => line.trim());
    const header = csvLines[0];
    const dataRows = csvLines.slice(1);
    const chunkSize = 50; // Process 50 rows at a time
    const chunks = [];

    for (let i = 0; i < dataRows.length; i += chunkSize) {
      const chunk = [header, ...dataRows.slice(i, i + chunkSize)];
      chunks.push(chunk.join('\n'));
    }

    console.log(`Processing ${dataRows.length} rows in ${chunks.length} chunks`);

    // Process each chunk
    const allPreparedData = [];
    let totalDuplicatesRemoved = 0;
    let totalCompleteTests = 0;
    let totalIncompleteTests = 0;
    const allIssues = [];
    const mapping = {
      testNameSource: [],
      testStepsSource: [],
      prioritySource: [],
      featureSource: [],
    };

    for (let i = 0; i < chunks.length; i++) {
      console.log(
        `Processing chunk ${i + 1}/${chunks.length} (${chunks[i].split('\n').length - 1} data rows)`,
      );

      const userPrompt = CSV_PREPARATION_USER_PREFIX.replace(
        '{analysis}',
        JSON.stringify(analysis, null, 2),
      )
        .replace('{normalization}', JSON.stringify(normalization, null, 2))
        .replace('{csvData}', chunks[i]);

      const preparationResponse = await openaiService.callOpenAI(
        CSV_PREPARATION_SYSTEM,
        userPrompt,
      );

      // Try to parse the JSON response
      let preparation;
      try {
        // Remove markdown code blocks and extract JSON
        let jsonString = preparationResponse;

        // Look for JSON within markdown code blocks
        const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonString = jsonMatch[1];
        } else if (jsonString.includes('```')) {
          // Fallback: remove any code block markers
          jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
        }

        // Remove any leading text before the JSON
        const jsonStart = jsonString.indexOf('{');
        if (jsonStart > 0) {
          jsonString = jsonString.substring(jsonStart);
        }

        preparation = JSON.parse(jsonString);

        // Accumulate results
        if (preparation.preparedData) {
          console.log(`Chunk ${i + 1} returned ${preparation.preparedData.length} prepared tests`);
          allPreparedData.push(...preparation.preparedData);
        }
        if (preparation.summary) {
          totalDuplicatesRemoved += preparation.summary.duplicatesRemoved || 0;
          totalCompleteTests += preparation.summary.dataQuality?.completeTests || 0;
          totalIncompleteTests += preparation.summary.dataQuality?.incompleteTests || 0;
          if (preparation.summary.dataQuality?.issues) {
            allIssues.push(...preparation.summary.dataQuality.issues);
          }
          if (preparation.summary.mapping) {
            Object.keys(mapping).forEach((key) => {
              if (
                preparation.summary.mapping[key] &&
                !mapping[key].includes(preparation.summary.mapping[key])
              ) {
                mapping[key].push(preparation.summary.mapping[key]);
              }
            });
          }
        }
      } catch (parseError) {
        console.error(`Failed to parse preparation JSON for chunk ${i + 1}:`, parseError);
        return res.status(500).json({
          error: `Failed to parse preparation response from AI service for chunk ${i + 1}`,
          rawResponse: preparationResponse,
        });
      }
    }

    // Create final response
    console.log(
      `Final result: ${allPreparedData.length} total prepared tests from ${dataRows.length} input rows`,
    );

    const preparation = {
      preparedData: allPreparedData,
      summary: {
        totalTests: allPreparedData.length,
        duplicatesRemoved: totalDuplicatesRemoved,
        dataQuality: {
          completeTests: totalCompleteTests,
          incompleteTests: totalIncompleteTests,
          issues: allIssues,
        },
        mapping: {
          testNameSource: [...new Set(mapping.testNameSource)],
          testStepsSource: [...new Set(mapping.testStepsSource)],
          prioritySource: [...new Set(mapping.prioritySource)],
          featureSource: [...new Set(mapping.featureSource)],
        },
      },
      recommendations: {
        chunkingStrategy: `Processed in ${chunks.length} chunks of ${chunkSize} rows each`,
        processingOrder: 'Processed by priority first, then by feature',
        warnings: [],
      },
    };

    res.json({
      success: true,
      preparation,
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in prepareCsv:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// Context Normalization endpoint (Second Buffer)
router.post('/normalize-context', upload.single('csvFile'), async (req, res) => {
  try {
    // Check if this is a file upload (multipart/form-data) or JSON body
    let csvContent, analysis, context;

    if (req.file) {
      // Handle file upload
      csvContent = req.file.buffer.toString('utf-8');
      analysis = JSON.parse(req.body.analysis || '{}');
      context = req.body.context || '';
    } else {
      // Handle JSON body (for backward compatibility)
      ({ csvContent, analysis, context } = req.body);
    }

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({
        error:
          'CSV content is required. Please upload a CSV file or provide csvContent in the request body.',
      });
    }

    if (!analysis || typeof analysis !== 'object') {
      return res.status(400).json({
        error:
          'Analysis results are required. Please provide the analysis from the /analyze-csv endpoint.',
      });
    }

    if (csvContent.trim().length === 0) {
      return res.status(400).json({
        error: 'CSV content cannot be empty',
      });
    }

    // Check if context normalization is needed
    if (
      !analysis.contextAnalysis ||
      !analysis.contextAnalysis.rowsWithMissingContext ||
      analysis.contextAnalysis.rowsWithMissingContext.length === 0
    ) {
      return res.json({
        success: true,
        message: 'No context normalization needed - all rows have sufficient context',
        normalization: {
          normalizedRows: [],
          continuationGroups: [],
          summary: {
            totalNormalized: 0,
            continuationsCreated: 0,
            standaloneTests: 0,
            highConfidence: 0,
            mediumConfidence: 0,
            lowConfidence: 0,
          },
        },
        context: context || 'No context provided',
      });
    }

    // Prepare the context normalization
    const missingContextRows = analysis.contextAnalysis.rowsWithMissingContext;
    const userPrompt = CONTEXT_NORMALIZATION_USER_PREFIX.replace(
      '{analysis}',
      JSON.stringify(analysis, null, 2),
    )
      .replace('{csvData}', csvContent)
      .replace('{missingContextRows}', JSON.stringify(missingContextRows, null, 2));

    const normalizationResponse = await openaiService.callOpenAI(
      CONTEXT_NORMALIZATION_SYSTEM,
      userPrompt,
    );

    // Try to parse the JSON response
    let normalization;
    try {
      // Remove markdown code blocks and extract JSON
      let jsonString = normalizationResponse;

      // Look for JSON within markdown code blocks
      const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else if (jsonString.includes('```')) {
        // Fallback: remove any code block markers
        jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
      }

      // Remove any leading text before the JSON
      const jsonStart = jsonString.indexOf('{');
      if (jsonStart > 0) {
        jsonString = jsonString.substring(jsonStart);
      }

      normalization = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse normalization JSON:', parseError);
      return res.status(500).json({
        error: 'Failed to parse normalization response from AI service',
        rawResponse: normalizationResponse,
      });
    }

    res.json({
      success: true,
      normalization,
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in normalizeContext:', error);
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

// AAA Conversion Phase 1 - First Quarter (25%)
router.post('/convert-aaa/phase1', async (req, res) => {
  try {
    const { preparedData, context } = req.body;

    if (!preparedData || !Array.isArray(preparedData) || preparedData.length === 0) {
      return res.status(400).json({
        error: 'Prepared data is required and must be an array',
      });
    }

    // Calculate quarter size and review size
    const totalTests = preparedData.length;
    const quarterSize = Math.ceil(totalTests / 4);
    const reviewSize = Math.max(5, Math.min(20, Math.ceil(quarterSize * 0.25)));

    // Get first quarter of test cases
    const firstQuarter = preparedData.slice(0, quarterSize);
    const testCasesForReview = firstQuarter.slice(0, reviewSize);

    console.log(
      `Phase 1: Processing ${firstQuarter.length} tests, reviewing ${testCasesForReview.length}`,
    );

    // Get learning context
    const learningContext = learningService.generateLearningContext();
    const personalizedEnhancements = learningService.getPersonalizedEnhancements();

    // Convert test cases to AAA estimates
    const userPrompt = AAA_CONVERSION_USER_PREFIX.replace(
      '{testCases}',
      JSON.stringify(testCasesForReview, null, 2),
    )
      .replace('{feedback}', 'No previous feedback - this is the first phase')
      .replace(
        '{learningContext}',
        JSON.stringify(
          {
            ...learningContext,
            personalizedEnhancements,
            totalLearningEntries: learningContext.totalLearningEntries,
          },
          null,
          2,
        ),
      );

    const conversionResponse = await openaiService.callOpenAI(AAA_CONVERSION_SYSTEM, userPrompt);

    // Parse the response
    let conversion;
    try {
      let jsonString = conversionResponse;

      const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else if (jsonString.includes('```')) {
        jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
      }

      const jsonStart = jsonString.indexOf('{');
      if (jsonStart > 0) {
        jsonString = jsonString.substring(jsonStart);
      }

      conversion = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse conversion JSON:', parseError);
      return res.status(500).json({
        error: 'Failed to parse conversion response from AI service',
        rawResponse: conversionResponse,
      });
    }

    res.json({
      success: true,
      phase: 1,
      conversion,
      reviewInfo: {
        totalTestsInPhase: firstQuarter.length,
        testsForReview: testCasesForReview.length,
        remainingTests: firstQuarter.length - testCasesForReview.length,
        nextPhaseStart: quarterSize,
      },
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in convertAAA Phase 1:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// AAA Conversion Phase 2 - Second Quarter (25%)
router.post('/convert-aaa/phase2', async (req, res) => {
  try {
    const { preparedData, phase1Feedback, context } = req.body;

    if (!preparedData || !Array.isArray(preparedData) || preparedData.length === 0) {
      return res.status(400).json({
        error: 'Prepared data is required and must be an array',
      });
    }

    // Calculate quarter boundaries
    const totalTests = preparedData.length;
    const quarterSize = Math.ceil(totalTests / 4);
    const reviewSize = Math.max(5, Math.min(20, Math.ceil(quarterSize * 0.25)));

    // Get second quarter of test cases
    const secondQuarter = preparedData.slice(quarterSize, quarterSize * 2);
    const testCasesForReview = secondQuarter.slice(0, reviewSize);

    console.log(
      `Phase 2: Processing ${secondQuarter.length} tests, reviewing ${testCasesForReview.length}`,
    );

    // Prepare feedback context
    const feedbackContext = phase1Feedback
      ? `Previous feedback from Phase 1:\n${JSON.stringify(phase1Feedback, null, 2)}`
      : 'No feedback from Phase 1';

    // Convert test cases to AAA estimates
    const userPrompt = AAA_CONVERSION_USER_PREFIX.replace(
      '{testCases}',
      JSON.stringify(testCasesForReview, null, 2),
    ).replace('{feedback}', feedbackContext);

    const conversionResponse = await openaiService.callOpenAI(AAA_CONVERSION_SYSTEM, userPrompt);

    // Parse the response
    let conversion;
    try {
      let jsonString = conversionResponse;

      const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else if (jsonString.includes('```')) {
        jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
      }

      const jsonStart = jsonString.indexOf('{');
      if (jsonStart > 0) {
        jsonString = jsonString.substring(jsonStart);
      }

      conversion = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse conversion JSON:', parseError);
      return res.status(500).json({
        error: 'Failed to parse conversion response from AI service',
        rawResponse: conversionResponse,
      });
    }

    res.json({
      success: true,
      phase: 2,
      conversion,
      reviewInfo: {
        totalTestsInPhase: secondQuarter.length,
        testsForReview: testCasesForReview.length,
        remainingTests: secondQuarter.length - testCasesForReview.length,
        nextPhaseStart: quarterSize * 2,
      },
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in convertAAA Phase 2:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// AAA Conversion Phase 3 - Third Quarter (25%)
router.post('/convert-aaa/phase3', async (req, res) => {
  try {
    const { preparedData, phase1Feedback, phase2Feedback, context } = req.body;

    if (!preparedData || !Array.isArray(preparedData) || preparedData.length === 0) {
      return res.status(400).json({
        error: 'Prepared data is required and must be an array',
      });
    }

    // Calculate quarter boundaries
    const totalTests = preparedData.length;
    const quarterSize = Math.ceil(totalTests / 4);
    const reviewSize = Math.max(5, Math.min(20, Math.ceil(quarterSize * 0.25)));

    // Get third quarter of test cases
    const thirdQuarter = preparedData.slice(quarterSize * 2, quarterSize * 3);
    const testCasesForReview = thirdQuarter.slice(0, reviewSize);

    console.log(
      `Phase 3: Processing ${thirdQuarter.length} tests, reviewing ${testCasesForReview.length}`,
    );

    // Prepare feedback context
    const feedbackContext = `Previous feedback from Phase 1:\n${phase1Feedback ? JSON.stringify(phase1Feedback, null, 2) : 'No feedback'}\n\nPrevious feedback from Phase 2:\n${phase2Feedback ? JSON.stringify(phase2Feedback, null, 2) : 'No feedback'}`;

    // Convert test cases to AAA estimates
    const userPrompt = AAA_CONVERSION_USER_PREFIX.replace(
      '{testCases}',
      JSON.stringify(testCasesForReview, null, 2),
    ).replace('{feedback}', feedbackContext);

    const conversionResponse = await openaiService.callOpenAI(AAA_CONVERSION_SYSTEM, userPrompt);

    // Parse the response
    let conversion;
    try {
      let jsonString = conversionResponse;

      const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else if (jsonString.includes('```')) {
        jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
      }

      const jsonStart = jsonString.indexOf('{');
      if (jsonStart > 0) {
        jsonString = jsonString.substring(jsonStart);
      }

      conversion = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse conversion JSON:', parseError);
      return res.status(500).json({
        error: 'Failed to parse conversion response from AI service',
        rawResponse: conversionResponse,
      });
    }

    res.json({
      success: true,
      phase: 3,
      conversion,
      reviewInfo: {
        totalTestsInPhase: thirdQuarter.length,
        testsForReview: testCasesForReview.length,
        remainingTests: thirdQuarter.length - testCasesForReview.length,
        nextPhaseStart: quarterSize * 3,
      },
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in convertAAA Phase 3:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// AAA Conversion Final - Complete Dataset with All Feedback
router.post('/convert-aaa/final', async (req, res) => {
  try {
    const {
      preparedData,
      phase1Feedback,
      phase2Feedback,
      phase3Feedback,
      phase4Feedback,
      context,
    } = req.body;

    if (!preparedData || !Array.isArray(preparedData) || preparedData.length === 0) {
      return res.status(400).json({
        error: 'Prepared data is required and must be an array',
      });
    }

    console.log(
      `Final conversion: Processing ALL ${preparedData.length} tests with complete feedback`,
    );

    // Validate we have the expected number of tests
    if (preparedData.length < 120) {
      console.warn(
        `⚠️  WARNING: Only ${preparedData.length} tests received, expected ~126. This may indicate data loss in previous steps.`,
      );
    }

    // Prepare comprehensive feedback context
    const feedbackContext = `Complete feedback from all phases:

Phase 1 Feedback:
${phase1Feedback ? JSON.stringify(phase1Feedback, null, 2) : 'No feedback provided'}

Phase 2 Feedback:
${phase2Feedback ? JSON.stringify(phase2Feedback, null, 2) : 'No feedback provided'}

Phase 3 Feedback:
${phase3Feedback ? JSON.stringify(phase3Feedback, null, 2) : 'No feedback provided'}

Phase 4 Feedback:
${phase4Feedback ? JSON.stringify(phase4Feedback, null, 2) : 'No feedback provided'}

Please apply all feedback patterns and corrections to ensure consistent, high-quality AAA estimates across the entire dataset.`;

    // Process in chunks to avoid context window limits
    const chunkSize = 50;
    const chunks = [];

    for (let i = 0; i < preparedData.length; i += chunkSize) {
      chunks.push(preparedData.slice(i, i + chunkSize));
    }

    console.log(
      `Processing ${preparedData.length} tests in ${chunks.length} chunks for final conversion`,
    );

    // Log chunk details for debugging
    chunks.forEach((chunk, index) => {
      console.log(
        `Chunk ${index + 1}: ${chunk.length} tests (rows ${index * chunkSize + 1} to ${Math.min((index + 1) * chunkSize, preparedData.length)})`,
      );
    });

    // Process each chunk
    const allConvertedTests = [];
    const allFeatureGroups = new Set();

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing final chunk ${i + 1}/${chunks.length} (${chunks[i].length} tests)`);

      const userPrompt = AAA_CONVERSION_USER_PREFIX.replace(
        '{testCases}',
        JSON.stringify(chunks[i], null, 2),
      ).replace('{feedback}', feedbackContext);

      const conversionResponse = await openaiService.callOpenAI(AAA_CONVERSION_SYSTEM, userPrompt);

      // Parse the response
      let conversion;
      try {
        let jsonString = conversionResponse;

        const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonString = jsonMatch[1];
        } else if (jsonString.includes('```')) {
          jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
        }

        const jsonStart = jsonString.indexOf('{');
        if (jsonStart > 0) {
          jsonString = jsonString.substring(jsonStart);
        }

        conversion = JSON.parse(jsonString);

        // Accumulate results
        if (conversion.convertedTests) {
          console.log(
            `Final chunk ${i + 1} returned ${conversion.convertedTests.length} converted tests`,
          );
          allConvertedTests.push(...conversion.convertedTests);
        }
        if (conversion.summary && conversion.summary.featureGroups) {
          conversion.summary.featureGroups.forEach((feature) => allFeatureGroups.add(feature));
        }
      } catch (parseError) {
        console.error(`Failed to parse final conversion JSON for chunk ${i + 1}:`, parseError);
        return res.status(500).json({
          error: `Failed to parse final conversion response from AI service for chunk ${i + 1}`,
          rawResponse: conversionResponse,
        });
      }
    }

    // Create final response
    const finalConversion = {
      convertedTests: allConvertedTests,
      summary: {
        totalTests: allConvertedTests.length,
        featureGroups: Array.from(allFeatureGroups),
        averageTestsPerCase:
          allConvertedTests.length > 0
            ? (
                allConvertedTests.reduce((sum, test) => sum + test.estimatedAAATests, 0) /
                allConvertedTests.length
              ).toFixed(2)
            : 0,
        reasoning: `Complete conversion processed in ${chunks.length} chunks with all accumulated feedback applied for consistency`,
      },
    };

    console.log(`Final conversion complete: ${allConvertedTests.length} total converted tests`);

    // Validate we didn't lose any tests during conversion
    if (allConvertedTests.length !== preparedData.length) {
      console.error(
        `❌ ERROR: Test count mismatch! Input: ${preparedData.length}, Output: ${allConvertedTests.length}`,
      );
      console.error(
        `Missing ${preparedData.length - allConvertedTests.length} tests during conversion`,
      );
    } else {
      console.log(`✅ SUCCESS: All ${preparedData.length} tests converted successfully`);
    }

    res.json({
      success: true,
      phase: 'final',
      conversion: finalConversion,
      reviewInfo: {
        totalTestsProcessed: preparedData.length,
        totalConvertedTests: allConvertedTests.length,
        isComplete: true,
        feedbackApplied: {
          phase1: !!phase1Feedback,
          phase2: !!phase2Feedback,
          phase3: !!phase3Feedback,
          phase4: !!phase4Feedback,
        },
      },
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in convertAAA Final:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// AAA Conversion Phase 4 - Final Quarter (25%) - Returns Complete Conversion
router.post('/convert-aaa/phase4', async (req, res) => {
  try {
    const { preparedData, phase1Feedback, phase2Feedback, phase3Feedback, context } = req.body;

    if (!preparedData || !Array.isArray(preparedData) || preparedData.length === 0) {
      return res.status(400).json({
        error: 'Prepared data is required and must be an array',
      });
    }

    // Calculate quarter boundaries
    const totalTests = preparedData.length;
    const quarterSize = Math.ceil(totalTests / 4);

    // Get final quarter of test cases
    const finalQuarter = preparedData.slice(quarterSize * 3);

    console.log(`Phase 4: Processing final ${finalQuarter.length} tests (complete conversion)`);

    // Prepare feedback context
    const feedbackContext = `Previous feedback from Phase 1:\n${phase1Feedback ? JSON.stringify(phase1Feedback, null, 2) : 'No feedback'}\n\nPrevious feedback from Phase 2:\n${phase2Feedback ? JSON.stringify(phase2Feedback, null, 2) : 'No feedback'}\n\nPrevious feedback from Phase 3:\n${phase3Feedback ? JSON.stringify(phase3Feedback, null, 2) : 'No feedback'}`;

    // Convert ALL remaining test cases to AAA estimates
    const userPrompt = AAA_CONVERSION_USER_PREFIX.replace(
      '{testCases}',
      JSON.stringify(finalQuarter, null, 2),
    ).replace('{feedback}', feedbackContext);

    const conversionResponse = await openaiService.callOpenAI(AAA_CONVERSION_SYSTEM, userPrompt);

    // Parse the response
    let conversion;
    try {
      let jsonString = conversionResponse;

      const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else if (jsonString.includes('```')) {
        jsonString = jsonString.replace(/```\s*/, '').replace(/\s*```$/, '');
      }

      const jsonStart = jsonString.indexOf('{');
      if (jsonStart > 0) {
        jsonString = jsonString.substring(jsonStart);
      }

      conversion = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse conversion JSON:', parseError);
      return res.status(500).json({
        error: 'Failed to parse conversion response from AI service',
        rawResponse: conversionResponse,
      });
    }

    res.json({
      success: true,
      phase: 4,
      conversion,
      reviewInfo: {
        totalTestsInPhase: finalQuarter.length,
        testsForReview: finalQuarter.length, // Complete conversion
        remainingTests: 0,
        isComplete: true,
      },
      context: context || 'No context provided',
    });
  } catch (error) {
    console.error('Error in convertAAA Phase 4:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// Learning and Feedback Management
router.post('/learn/record-feedback', async (req, res) => {
  try {
    const { phase, feedback } = req.body;

    if (!phase || !feedback) {
      return res.status(400).json({
        error: 'Phase and feedback are required',
      });
    }

    // Record feedback for learning
    learningService.recordFeedback(phase, feedback);

    // Generate updated learning insights
    const learningInsights = learningService.generateLearningContext();

    res.json({
      success: true,
      message: 'Feedback recorded for learning',
      learningInsights: {
        totalLearningEntries: learningInsights.totalLearningEntries,
        recentPatterns: learningInsights.learnedPatterns.length,
        insights: learningInsights.learningInsights,
      },
    });
  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

router.get('/learn/insights', async (req, res) => {
  try {
    const learningContext = learningService.generateLearningContext();

    res.json({
      success: true,
      learningData: {
        totalEntries: learningContext.totalLearningEntries,
        patterns: learningContext.learnedPatterns,
        insights: learningContext.learningInsights,
        recentFeedback: learningContext.recentFeedback.slice(-5), // Last 5 entries
      },
    });
  } catch (error) {
    console.error('Error getting learning insights:', error);
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
      'normalize-context': 'POST /api/ratio-estimator/normalize-context',
      'prepare-csv': 'POST /api/ratio-estimator/prepare-csv',
      'convert-aaa-phase1': 'POST /api/ratio-estimator/convert-aaa/phase1',
      'convert-aaa-phase2': 'POST /api/ratio-estimator/convert-aaa/phase2',
      'convert-aaa-phase3': 'POST /api/ratio-estimator/convert-aaa/phase3',
      'convert-aaa-phase4': 'POST /api/ratio-estimator/convert-aaa/phase4',
      'convert-aaa-final': 'POST /api/ratio-estimator/convert-aaa/final',
      'initial-estimate': 'POST /api/ratio-estimator/estimate/initial',
      'post-process': 'POST /api/ratio-estimator/estimate/postprocess',
      'fix-rejections': 'POST /api/ratio-estimator/estimate/fix-rejections',
    },
  });
});

export default router;
