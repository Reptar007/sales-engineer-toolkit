import express from 'express';
import { getSalesforceConnection, getQuarterName } from './functions.js';

const router = express.Router();

// Don't create connection at startup - create it per request
let conn = null;

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Salesforce API',
    timestamp: new Date().toISOString(),
    message: 'Salesforce API is running and ready',
  });
});

// Main endpoint - query Account data
router.get('/', async (req, res) => {
  try {
    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    const result = await conn.query('SELECT Id, Name FROM Account LIMIT 5');
    res.json({
      success: true,
      data: result,
      totalSize: result.totalSize,
    });
  } catch (error) {
    console.error('Salesforce API error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to connect to Salesforce. Please check your credentials.',
    });
  }
});

// Get data from a specific report
router.get('/report/:reportId', async (req, res) => {
  const { reportId } = req.params;

  try {
    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    console.log(`Fetching report data for report ID: ${reportId}`);

    // Use the Reports API to get the actual report data
    const result = await conn.analytics.report(reportId).execute({
      details: true,
    });

    // Format the result to be more readable
    const quarterlyData = {};
    const allOpportunities = [];

    Object.keys(result.factMap).forEach((quarterKey) => {
      const quarterData = result.factMap[quarterKey];

      const quarterName = getQuarterName(quarterKey, result.groupingsDown);

      const opportunities = [];
      quarterData.rows.forEach((row) => {
        const dataCells = row.dataCells;

        // Parse each opportunity record
        const opportunity = {
          aeName: dataCells[0]?.label || '', // AE Name
          opportunityName: dataCells[1]?.label || '', // Opportunity Name
          arrAmount: dataCells[2]?.value?.amount || 0, // ARR Amount (numeric)
          arrAmountFormatted: dataCells[2]?.label || '', // ARR Amount (formatted)
          salesScore: dataCells[3]?.label || '', // Sales Score (Account Score)
          effectiveDate: dataCells[4]?.label || '', // Effective Date

          // Additional IDs for reference
          aeId: dataCells[0]?.value || '',
          opportunityId: dataCells[1]?.value || '',

          // Quarter info
          quarter: quarterName,
        };

        opportunities.push(opportunity);
        allOpportunities.push(opportunity);
      });

      quarterlyData[quarterName] = {
        quarter: quarterName,
        totalARR: quarterData.aggregates[0]?.value || 0,
        totalARRFormatted: quarterData.aggregates[0]?.label || '',
        opportunityCount: quarterData.aggregates[1]?.value || 0,
        opportunities: opportunities,
      };
    });

    res.json({
      success: true,
      reportId: reportId,
      totalOpportunities: allOpportunities.length,
      quarterlyData: quarterlyData,
      allOpportunities: allOpportunities,
    });
  } catch (error) {
    console.error('Salesforce API error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details:
        'Failed to fetch report from Salesforce. Please check the report ID and permissions.',
    });
  }
});

export default router;
