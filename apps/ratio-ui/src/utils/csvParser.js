// CSV Parser utility for handling uploaded CSV files

/**
 * Parse CSV content into array of objects matching the expected data structure
 * Expected CSV format: Test Name, Ratio, Reasoning
 * @param {string} csvContent - Raw CSV file content
 * @returns {Array} Array of parsed test objects
 */
export const parseCsvContent = (csvContent) => {
  if (!csvContent || typeof csvContent !== 'string') {
    throw new Error('Invalid CSV content provided');
  }

  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV file must contain at least a header row and one data row');
  }

  // Parse header row (case-insensitive)
  const headerRow = lines[0]
    .split(',')
    .map((header) => header.trim().replace(/['"]/g, '').toLowerCase());

  // Expected headers (flexible matching)
  const expectedHeaders = {
    testName: ['test name', 'testname', 'name', 'test'],
    ratio: ['ratio', 'test ratio'],
    reasoning: ['reasoning', 'reason', 'analysis', 'description'],
  };

  // Find column indices
  const columnIndices = {};
  Object.keys(expectedHeaders).forEach((key) => {
    const headerIndex = headerRow.findIndex((header) =>
      expectedHeaders[key].some((expectedHeader) => header.includes(expectedHeader)),
    );
    if (headerIndex === -1) {
      throw new Error(
        `Required column not found: ${key}. Expected one of: ${expectedHeaders[key].join(', ')}`,
      );
    }
    columnIndices[key] = headerIndex;
  });

  // Parse data rows
  const parsedData = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    // Simple CSV parsing (handles basic comma separation)
    const columns = line.split(',').map((col) => col.trim().replace(/^["']|["']$/g, ''));

    if (columns.length < Math.max(...Object.values(columnIndices)) + 1) {
      console.warn(`Row ${i + 1} has insufficient columns, skipping`);
      continue;
    }

    const testName = columns[columnIndices.testName]?.trim();
    const ratio = columns[columnIndices.ratio]?.trim();
    const reasoning = columns[columnIndices.reasoning]?.trim();

    // Validate required fields
    if (!testName) {
      console.warn(`Row ${i + 1}: Test name is empty, skipping`);
      continue;
    }

    if (!ratio) {
      console.warn(`Row ${i + 1}: Ratio is empty, skipping`);
      continue;
    }

    if (!reasoning) {
      console.warn(`Row ${i + 1}: Reasoning is empty, skipping`);
      continue;
    }

    // Validate ratio format (should be like "3:5" or "2.5")
    if (!isValidRatio(ratio)) {
      console.warn(`Row ${i + 1}: Invalid ratio format "${ratio}", skipping`);
      continue;
    }

    parsedData.push({
      id: i, // Use row number as ID
      testName: testName,
      ratio: ratio,
      reasoning: reasoning,
      status: 'pending', // All uploaded tests start as pending
    });
  }

  if (parsedData.length === 0) {
    throw new Error('No valid data rows found in CSV file');
  }

  return parsedData;
};

/**
 * Validate ratio format (accepts "3:5" or "2.5" formats)
 * @param {string} ratio - Ratio string to validate
 * @returns {boolean} True if valid ratio format
 */
const isValidRatio = (ratio) => {
  if (!ratio || typeof ratio !== 'string') return false;

  // Check for colon format (e.g., "3:5")
  if (ratio.includes(':')) {
    const parts = ratio.split(':');
    if (parts.length === 2) {
      return parts.every((part) => !isNaN(parseFloat(part.trim())) && isFinite(part.trim()));
    }
  }

  // Check for decimal format (e.g., "2.5")
  const numValue = parseFloat(ratio);
  return !isNaN(numValue) && isFinite(numValue) && numValue > 0;
};

/**
 * Read and parse a CSV file
 * @param {File} file - CSV file object
 * @returns {Promise<Array>} Promise resolving to parsed data array
 */
export const parseCSVFile = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'));
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      reject(new Error('File must be a CSV file'));
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const csvContent = event.target.result;
        const parsedData = parseCsvContent(csvContent);
        resolve(parsedData);
      } catch (error) {
        reject(new Error(`Failed to parse CSV: ${error.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read CSV file'));
    };

    reader.readAsText(file);
  });
};
