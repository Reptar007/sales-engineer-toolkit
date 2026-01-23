/**
 * Main tRPC Router
 * This is the root router that combines all project routers
 * Projects can add their routers here to make them available via tRPC
 */

import { router, publicProcedure } from '../lib/trpc.js';

// Import project routers (uncomment as you create them)
// import { salesforceRouter } from '../projects/salesforce/trpc.js';
import { codeSummaryPdfRouter } from '../projects/code-summary-pdf/trpc.js';
// import { ratioEstimatorRouter } from '../projects/ratio-estimator/trpc.js';

/**
 * Root tRPC Router
 * Combine all project routers here
 *
 * Structure:
 * - Each project gets its own namespace
 * - All routers are merged at the root level
 * - Access via: trpc.projectName.procedureName
 */
export const appRouter = router({
  // Health check endpoint
  health: router({
    check: publicProcedure.query(async () => {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'tRPC',
      };
    }),
  }),

  // Project routers
  codeSummaryPdf: codeSummaryPdfRouter,
  // salesforce: salesforceRouter,
  // ratioEstimator: ratioEstimatorRouter,
});

// Note: For TypeScript frontend, you can create a separate .d.ts file or use JSDoc
// The router type can be inferred from appRouter in TypeScript projects
