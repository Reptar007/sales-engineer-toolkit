import express from 'express';
import { getSalesforceConnection, getQuarterName } from './functions.js';
import { authenticateToken } from '../../middleware/auth.js';

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

// Get data from a specific report (protected - requires authentication)
router.get('/report/:reportId', authenticateToken, async (req, res) => {
  const { reportId } = req.params;

  try {
    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    // Use the Reports API to get the actual report data
    const result = await conn.analytics.report(reportId).execute({
      details: true,
    });

    if (reportId === `00OPA000002sLkf2AE`) {
      // Format the result to be more readable
      const quarterlyData = {};
      const allOpportunities = [];

      Object.keys(result.factMap).forEach((quarterKey) => {
        const quarterData = result.factMap[quarterKey];

        const quarterName = getQuarterName(quarterKey, result.groupingsDown);

        // Skip "Total" entry - we'll calculate it separately after processing all quarters
        if (quarterName === 'Total') {
          return;
        }

        const opportunities = [];
        // Handle case where rows might not exist
        if (quarterData.rows && Array.isArray(quarterData.rows)) {
          quarterData.rows.forEach((row) => {
            const dataCells = row.dataCells;

            // Get AE ID from the opportunity
            const aeId = dataCells[0]?.value || '';

            // Parse each opportunity record
            const opportunity = {
              aeName: dataCells[0]?.label || '', // AE Name
              opportunityName: dataCells[1]?.label || '', // Opportunity Name
              arrAmount: dataCells[2]?.value?.amount || 0, // ARR Amount (numeric)
              arrAmountFormatted: dataCells[2]?.label || '', // ARR Amount (formatted)
              salesScore: dataCells[3]?.label || '', // Sales Score (Account Score)
              effectiveDate: dataCells[4]?.label || '', // Effective Date

              // Additional IDs for reference
              aeId: aeId,
              opportunityId: dataCells[1]?.value || '',

              // Quarter info
              quarter: quarterName,
            };

            opportunities.push(opportunity);
            allOpportunities.push(opportunity);
          });
        }

        // Recalculate totals for filtered opportunities
        const filteredTotalARR = opportunities.reduce((sum, opp) => sum + opp.arrAmount, 0);

        quarterlyData[quarterName] = {
          quarter: quarterName,
          totalARR: filteredTotalARR,
          totalARRFormatted: `$${filteredTotalARR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          opportunityCount: opportunities.length,
          opportunities: opportunities,
        };
      });

      // Calculate yearly total by summing all quarters (excluding "Total" entry)
      // This ensures accuracy after filtering
      let yearlyTotalARR = 0;
      Object.keys(quarterlyData).forEach((key) => {
        if (key !== 'Total') {
          yearlyTotalARR += quarterlyData[key].totalARR || 0;
        }
      });

      // Update or create "Total" entry with calculated yearly total
      quarterlyData['Total'] = {
        quarter: 'Total',
        totalARR: yearlyTotalARR,
        totalARRFormatted: `$${yearlyTotalARR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        opportunityCount: allOpportunities.length,
        opportunities: [], // Total doesn't need individual opportunities
      };

      res.json({
        success: true,
        reportId: reportId,
        totalOpportunities: allOpportunities.length,
        quarterlyData: quarterlyData,
        allOpportunities: allOpportunities,
        filtered: false, // No filtering - everyone sees all data
      });
    } else if (reportId === `00OPA000002uP5p2AE`) {
      const data = [];
      const rows = result.factMap['T!T'].rows;
      rows.forEach((row) => {
        const dataCells = row.dataCells;
        const opportunityId = dataCells[0]?.value || '';
        const opportunityName = dataCells[0]?.label || '';
        const stage = dataCells[1]?.label || '';
        const quarter = dataCells[2]?.label || '';
        const type = dataCells[3]?.label || '';
        const aeName = dataCells[4]?.label || '';
        const probability = dataCells[5]?.value || '';
        const probabilityFormatted = dataCells[5]?.label || '';
        const arrAmount = dataCells[6]?.value?.amount || 0;
        const amount = dataCells[6]?.label || '';

        data.push({
          opportunityId: opportunityId,
          opportunityName: opportunityName,
          stage: stage,
          quarter: quarter,
          type: type,
          aeName: aeName,
          probability: probability,
          probabilityFormatted: probabilityFormatted,
          arrAmount: arrAmount,
          amount: amount,
        });
      });

      // Calculate totals
      const totalOpportunities = data.length;
      const totalARR = data.reduce((sum, opp) => sum + (opp.arrAmount || 0), 0);
      const totalARRFormatted = `$${totalARR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      res.json({
        success: true,
        reportId: reportId,
        totalOpportunities: totalOpportunities,
        totalARR: totalARR,
        totalARRFormatted: totalARRFormatted,
        data: data,
      });
    }
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
