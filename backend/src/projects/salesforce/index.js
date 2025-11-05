import express from 'express';
import { getSalesforceConnection, getQuarterName } from './functions.js';
import { authenticateToken } from '../../middleware/auth.js';
import prisma from '../../lib/prisma.js';

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
  const user = req.user; // User from authentication middleware

  try {
    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    // Use the Reports API to get the actual report data
    const result = await conn.analytics.report(reportId).execute({
      details: true,
    });

    // Get user's allowed AE IDs based on role
    let allowedAeIds = null; // null = all AEs (admin), array = specific AEs

    // Check if user is admin - admins see all data
    const isAdmin = user.roles && user.roles.includes('admin');

    if (!isAdmin) {
      // For non-admin users, get their team's AEs
      const salesEngineer = await prisma.salesEngineer.findUnique({
        where: { userId: user.id },
        include: {
          team: {
            include: {
              accountExecutives: {
                where: { isActive: true },
                select: {
                  salesforceId: true,
                },
              },
            },
          },
        },
      });

      if (salesEngineer && salesEngineer.team) {
        // Get list of allowed Salesforce IDs
        allowedAeIds = salesEngineer.team.accountExecutives.map((ae) => ae.salesforceId);
      } else {
        // User has no team assigned - no access to opportunities
        allowedAeIds = [];
      }
    }

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

          // Filter opportunities: if allowedAeIds is null (admin), show all; otherwise filter
          const shouldInclude = allowedAeIds === null || allowedAeIds.includes(aeId);

          if (!shouldInclude) {
            return; // Skip this opportunity
          }

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
      filtered: allowedAeIds !== null, // Indicates if data was filtered
      userRole: isAdmin ? 'admin' : 'sales_engineer',
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
