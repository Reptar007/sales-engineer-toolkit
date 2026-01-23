// Google Sheets Service
// This service handles all Google Sheets API operations for the code-summary-pdf project

import { google } from 'googleapis';
import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve1PasswordValue } from '../../../functions/resolve1Password.js';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
// Try multiple .env file locations
dotenv.config({ path: resolve(__dirname, '../../../../.env') }); // backend/.env
dotenv.config({ path: resolve(__dirname, '../../../../../.env') }); // root .env
dotenv.config(); // Also load from process.env and default .env location

// Get Google Sheets configuration from environment
// Read directly from process.env to ensure we get the latest value
const GOOGLE_SHEETS_CREDENTIALS = process.env.GOOGLE_SHEETS_CREDENTIALS;
// const GOOGLE_SHEETS_TEMPLATE_ID = process.env.GOOGLE_SHEETS_TEMPLATE_ID; // Reserved for future use

/**
 * Load Google service account credentials
 * Handles both 1Password references (op://) and file paths
 * @returns {Object} Parsed credentials object
 * @throws {Error} If credentials cannot be loaded
 */
function loadCredentials() {
  // Re-read from process.env in case it was set after module load
  // This ensures we get the value even if dotenv loaded it after module initialization
  const credentialsEnv = process.env.GOOGLE_SHEETS_CREDENTIALS || GOOGLE_SHEETS_CREDENTIALS;

  if (!credentialsEnv) {
    // Debug: log what environment variables are available
    const availableVars = Object.keys(process.env).filter(
      (key) => key.includes('GOOGLE') || key.includes('SHEET'),
    );
    console.error('Available Google-related env vars:', availableVars);
    throw new Error(
      'GOOGLE_SHEETS_CREDENTIALS not configured. Please set GOOGLE_SHEETS_CREDENTIALS environment variable.',
    );
  }

  let credentialsJson;

  // Resolve 1Password references if needed
  const resolvedValue = resolve1PasswordValue(credentialsEnv);

  // Check if it's a file path (starts with / or ./ or ../ or contains path separators)
  if (
    resolvedValue.startsWith('/') ||
    resolvedValue.startsWith('./') ||
    resolvedValue.startsWith('../') ||
    (resolvedValue.includes('/') && !resolvedValue.startsWith('{'))
  ) {
    try {
      // Try to read as a file path
      credentialsJson = readFileSync(resolvedValue, 'utf-8');
    } catch (fileError) {
      // If file read fails, check if it might be JSON string instead
      if (resolvedValue.trim().startsWith('{')) {
        credentialsJson = resolvedValue;
      } else {
        throw new Error(
          `Failed to read credentials file at "${resolvedValue}": ${fileError.message}`,
        );
      }
    }
  } else {
    // Assume it's a JSON string (either direct JSON or from 1Password)
    credentialsJson = resolvedValue;
  }

  // Parse the JSON
  let credentials;
  try {
    credentials = JSON.parse(credentialsJson);
  } catch (parseError) {
    throw new Error(
      `Failed to parse Google Sheets credentials JSON: ${parseError.message}. ` +
        `Please ensure the credentials are valid JSON. First 100 chars: ${credentialsJson.substring(0, 100)}`,
    );
  }

  // Validate that it looks like a service account credential
  if (!credentials.type || credentials.type !== 'service_account') {
    throw new Error(
      'Invalid Google service account credentials. Expected type "service_account". ' +
        `Got type: ${credentials.type || 'undefined'}`,
    );
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      'Invalid Google service account credentials. Missing required fields: client_email or private_key.',
    );
  }

  return credentials;
}

// Required scopes for Google Sheets API
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive', // Needed for copying sheets and PDF export
];

/**
 * Initialize Google Sheets API client
 * @returns {{sheets: Object, drive: Object, auth: Object}} Initialized clients
 */
function initializeClients() {
  // Load credentials from 1Password or file
  const credentials = loadCredentials();

  // Create Google Auth client with credentials and scopes
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  // Initialize Sheets API client
  const sheets = google.sheets({ version: 'v4', auth });

  // Initialize Drive API client (for copying sheets and PDF export)
  const drive = google.drive({ version: 'v3', auth });

  return { sheets, drive, auth };
}

/**
 * Read data from a Google Sheet
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The A1 notation range to read (e.g., 'Sheet1!A1:B10')
 * @returns {Promise<Array>} Array of rows from the sheet
 */
export async function readSheetData(spreadsheetId, range) {
  if (!spreadsheetId) {
    throw new Error('spreadsheetId is required');
  }

  if (!range) {
    throw new Error('range is required (e.g., "Sheet1!A1:B10" or "Sheet1")');
  }

  // Normalize the range - if it ends with just "!", treat it as the entire sheet
  let normalizedRange = range.trim();
  if (normalizedRange.endsWith('!')) {
    // Remove the trailing "!" to read the entire sheet
    normalizedRange = normalizedRange.slice(0, -1);
  }

  try {
    // Initialize clients
    const { sheets } = initializeClients();

    // Read data from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: normalizedRange,
    });

    // Return the values array (rows)
    // If no data, return empty array
    return response.data.values || [];
  } catch (error) {
    console.error('Error reading sheet data:', error.message);

    // Provide more helpful error messages
    if (error.code === 404) {
      throw new Error(`Spreadsheet not found. Please verify the spreadsheet ID: ${spreadsheetId}`);
    }

    if (error.code === 403) {
      throw new Error(
        'Permission denied. Please ensure the service account has access to the spreadsheet.',
      );
    }

    // Check for range parsing errors
    if (error.message && error.message.includes('Unable to parse range')) {
      throw new Error(
        `Invalid range format: "${range}". Use format like "Sheet1!A1:B10" or just "Sheet1" for entire sheet.`,
      );
    }

    throw new Error(`Failed to read sheet data: ${error.message}`);
  }
}

/**
 * Write data to a Google Sheet
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} range - The A1 notation range to write to (e.g., 'Sheet1!A1')
 * @param {Array<Array>} values - 2D array of values to write
 * @returns {Promise<Object>} Update response
 */
// eslint-disable-next-line no-unused-vars
export async function writeSheetData(_spreadsheetId, _range, _values) {
  // TODO: Implement sheet writing
  // - Initialize clients
  // - Use sheets.spreadsheets.values.update() to write data
  // - Return the update response
}

/**
 * Batch update multiple ranges in a Google Sheet
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {Array<{range: string, values: Array<Array>}>} updates - Array of range/value pairs
 * @returns {Promise<Object>} Batch update response
 */
// eslint-disable-next-line no-unused-vars
export async function batchUpdateSheetData(_spreadsheetId, _updates) {
  // TODO: Implement batch updates
  // - Initialize clients
  // - Use sheets.spreadsheets.values.batchUpdate() for efficient multiple updates
  // - Return the batch update response
}

/**
 * Copy a template sheet to create a new sheet
 * @param {string} templateSpreadsheetId - The ID of the template spreadsheet
 * @param {string} newSheetName - Name for the new spreadsheet
 * @returns {Promise<string>} The ID of the newly created spreadsheet
 */
// eslint-disable-next-line no-unused-vars
export async function copyTemplateSheet(_templateSpreadsheetId, _newSheetName) {
  // TODO: Implement template copying
  // - Initialize clients
  // - Use drive.files.copy() to copy the template
  // - Update the name of the copied file
  // - Return the new spreadsheet ID
}

/**
 * Find cells containing specific text in a sheet
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {string} sheetName - Name of the sheet to search
 * @param {string} searchText - Text to search for
 * @returns {Promise<Array<{row: number, col: number, value: string}>>} Array of matching cell locations
 */
// eslint-disable-next-line no-unused-vars
export async function findCellsByText(_spreadsheetId, _sheetName, _searchText) {
  // TODO: Implement cell finding
  // - Read the entire sheet or a large range
  // - Search through the data for matching text
  // - Return array of cell locations (row, col, value)
}

/**
 * Replace placeholder text in a sheet with actual values
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @param {Object} replacements - Object mapping placeholder text to replacement values
 *   Example: { '{{WORKFLOW_NAME}}': 'My Workflow', '{{SUMMARY}}': 'Summary text' }
 * @returns {Promise<Object>} Update response
 */
// eslint-disable-next-line no-unused-vars
export async function replacePlaceholders(_spreadsheetId, _replacements) {
  // TODO: Implement placeholder replacement
  // - Find all cells containing placeholder text
  // - Replace each placeholder with its corresponding value
  // - Use batch updates for efficiency
}

/**
 * Create a new sheet from template and populate it with data
 * @param {string} flowName - The workflow/flow name
 * @param {string} summary - The generated summary text
 * @param {Array<{name: string, code: string}>} testSteps - Array of test steps with name and code
 * @param {string} helperCode - Combined code from utility tests (can be empty)
 * @returns {Promise<{spreadsheetId: string, url: string}>} The new spreadsheet ID and URL
 */
// eslint-disable-next-line no-unused-vars
export async function createSheetFromTemplate(_flowName, _summary, _testSteps, _helperCode = '') {
  // TODO: Implement sheet creation from template
  // - Copy the template sheet using copyTemplateSheet()
  // - Replace placeholders with actual data
  // - Write test steps data to appropriate ranges
  // - Write helper code if provided
  // - Return spreadsheet ID and URL
}

/**
 * Export a Google Sheet to PDF
 * @param {string} spreadsheetId - The ID of the spreadsheet to export
 * @param {string} sheetId - Optional: specific sheet ID to export (if not provided, exports all sheets)
 * @returns {Promise<Buffer>} PDF file as buffer
 */
// eslint-disable-next-line no-unused-vars
export async function exportSheetToPDF(_spreadsheetId, _sheetId = null) {
  // TODO: Implement PDF export
  // - Initialize clients
  // - Use drive.files.export() with mimeType 'application/pdf'
  // - Return the PDF buffer
}

/**
 * Get spreadsheet metadata
 * @param {string} spreadsheetId - The ID of the spreadsheet
 * @returns {Promise<Object>} Spreadsheet metadata including sheet names and IDs
 */
// eslint-disable-next-line no-unused-vars
export async function getSpreadsheetMetadata(_spreadsheetId) {
  // TODO: Implement metadata retrieval
  // - Initialize clients
  // - Use sheets.spreadsheets.get() to get metadata
  // - Return relevant metadata (title, sheets, etc.)
}

// Export the service object
export const sheetsService = {
  readSheetData,
  writeSheetData,
  batchUpdateSheetData,
  copyTemplateSheet,
  findCellsByText,
  replacePlaceholders,
  createSheetFromTemplate,
  exportSheetToPDF,
  getSpreadsheetMetadata,
};
