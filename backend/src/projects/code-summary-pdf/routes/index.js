import express from 'express';
// TODO: Import sheetsService when implemented
import { sheetsService } from '../services/sheetsService.js';

const router = express.Router();

// Project info endpoint
router.get('/', (req, res) => {
  res.json({
    project: 'Code Summary & PDF Generator',
    description: 'Generate summaries of test code and create PDFs from Google Sheets',
    version: '1.0.0',
    endpoints: {
      // TODO: Add endpoint documentation as routes are implemented
      'fetch-workflow': 'POST /api/code-summary-pdf/fetch-workflow',
      'generate-summary': 'POST /api/code-summary-pdf/generate-summary',
      // 'create-sheet': 'POST /api/code-summary-pdf/create-sheet',
      // 'generate-pdf': 'POST /api/code-summary-pdf/generate-pdf',
    },
  });
});

// TODO: Add routes for:
// - POST /create-sheet - Create a new sheet from template with data
// - POST /generate-pdf - Generate PDF from a sheet

// - GET /sheet/:spreadsheetId - Get sheet metadata
router.get('/sheet/:spreadsheetId', async (req, res) => {
  const { spreadsheetId } = req.params;
  const sheetData = await sheetsService.readSheetData(spreadsheetId, 'Sheet2!A1:Z100');
  res.json(sheetData);
});

// - POST /update-sheet - Update sheet data
// - Any other endpoints needed for the workflow

export default router;
