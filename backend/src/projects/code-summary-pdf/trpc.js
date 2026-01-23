/**
 * Code Summary PDF tRPC Router
 * Example of how to create a project-specific tRPC router
 *
 * This router can be imported and merged into the main appRouter
 * in backend/src/routes/trpc-router.js
 */

import { router, publicProcedure, protectedProcedure } from '../../lib/trpc.js';
import { z } from 'zod';
import { sheetsService } from './services/sheetsService.js';

/**
 * Code Summary PDF Router
 * All endpoints for the code-summary-pdf project
 *
 * Usage examples:
 * - trpc.codeSummaryPdf.readSheet.query({ spreadsheetId: '...', range: 'Sheet1!A1:B10' })
 * - trpc.codeSummaryPdf.getMetadata.query({ spreadsheetId: '...' })
 */
export const codeSummaryPdfRouter = router({
  /**
   * Read sheet data
   * Public endpoint - anyone can read sheet data
   */
  readSheet: publicProcedure
    .input(
      z.object({
        spreadsheetId: z.string().min(1, 'spreadsheetId is required'),
        range: z.string().min(1, 'range is required (e.g., "Sheet1!A1:B10" or "Sheet1")'),
      }),
    )
    .query(async ({ input }) => {
      const { spreadsheetId, range } = input;
      const data = await sheetsService.readSheetData(spreadsheetId, range);
      return {
        success: true,
        spreadsheetId,
        range,
        data,
        rowCount: data.length,
      };
    }),

  /**
   * Get spreadsheet metadata
   * Protected endpoint - requires authentication
   */
  getMetadata: protectedProcedure
    .input(
      z.object({
        spreadsheetId: z.string().min(1, 'spreadsheetId is required'),
      }),
    )
    .query(async ({ input, ctx }) => {
      // ctx.user is available here because this is a protectedProcedure
      // This would use getSpreadsheetMetadata when implemented
      // For now, return a placeholder
      return {
        success: true,
        spreadsheetId: input.spreadsheetId,
        requestedBy: ctx.user.email,
        message: 'Metadata endpoint - implement getSpreadsheetMetadata in sheetsService',
      };
    }),
});
