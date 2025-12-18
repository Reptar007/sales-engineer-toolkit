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

router.get(`/opportunity/search`, authenticateToken, async (req, res) => {
  try {
    const { search } = req.query;

    // Validation: Check if search term exists
    if (!search) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required',
        details: 'Please provide a search term in the query parameter',
      });
    }

    // Validation: Check minimum length
    const trimmedSearch = search.trim();
    if (trimmedSearch.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query too short',
        details: 'Search term must be at least 2 characters long',
      });
    }

    // Escape single quotes to prevent SOQL injection
    const escapedSearch = trimmedSearch.replace(/'/g, "\\'");

    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    // Build and execute SOQL query
    const result = await conn.query(
      `SELECT Id, Name, StageName, Amount, CloseDate, Probability, Type, 
         CreatedDate, LastModifiedDate,
         Description,
         NextStep,
         LeadSource,
         IsClosed,
         IsWon,
         LastActivityDate,
         ForecastCategory,
         Gross_ARR__c,
         ARR__c,
         AE_Detailed_Notes__c,
         Meeting_Booked_Details__c,
         Manager_Notes__c,
         Manager_Notes_Forecast__c,
         Account.Name, Account.Id, 
         Owner.Name, Owner.Id,
         Product__c,
         Account_Score__c,
         Competitor__c,
         Current_QA_Setup__c,
         Company_Size__c,
         Headcount_Range__c
      FROM Opportunity 
      WHERE (Name LIKE '%${escapedSearch}%' OR Account.Name LIKE '%${escapedSearch}%') 
      ORDER BY Name ASC
      LIMIT 50`,
    );

    // Transform results: flatten nested objects
    const transformedData = result.records.map((record) => {
      return {
        id: record.Id || '',
        name: record.Name || '',
        stage: record.StageName || '',
        amount: record.Amount || null,
        closeDate: record.CloseDate || null,
        probability: record.Probability || null,
        type: record.Type || '',
        createdDate: record.CreatedDate || null,
        lastModifiedDate: record.LastModifiedDate || null,
        description: record.Description || '',
        nextStep: record.NextStep || '',
        leadSource: record.LeadSource || '',
        isClosed: record.IsClosed || false,
        isWon: record.IsWon || false,
        lastActivityDate: record.LastActivityDate || null,
        forecastCategory: record.ForecastCategory || '',
        grossARR: record.Gross_ARR__c || null,
        arr: record.ARR__c || null,
        aeDetailedNotes: record.AE_Detailed_Notes__c || '',
        meetingBookedDetails: record.Meeting_Booked_Details__c || '',
        managerNotes: record.Manager_Notes__c || '',
        managerNotesForecast: record.Manager_Notes_Forecast__c || '',
        accountName: record.Account?.Name || '',
        accountId: record.Account?.Id || '',
        ownerName: record.Owner?.Name || '',
        ownerId: record.Owner?.Id || '',
        product: record.Product__c || '',
        accountScore: record.Account_Score__c || '',
        competitor: record.Competitor__c || '',
        currentQASetup: record.Current_QA_Setup__c || '',
        companySize: record.Company_Size__c || null,
        headcountRange: record.Headcount_Range__c || '',
      };
    });

    // Return success response
    res.json({
      success: true,
      count: transformedData.length,
      data: transformedData,
    });
  } catch (error) {
    console.error('Salesforce search error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to search opportunities in Salesforce. Please try again later.',
    });
  }
});

// Describe Opportunity object to find field names (helper endpoint)
router.get('/opportunity/fields', authenticateToken, async (req, res) => {
  try {
    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    // Get object metadata
    const metadata = await conn.sobject('Opportunity').describe();

    // Extract fields with name and label
    const fields = metadata.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      custom: field.custom,
    }));

    // Filter for fields containing "next" or "step" (case insensitive)
    const searchTerm = (req.query.search || '').toLowerCase();
    const filteredFields = searchTerm
      ? fields.filter(
          (field) =>
            field.name.toLowerCase().includes(searchTerm) ||
            field.label.toLowerCase().includes(searchTerm),
        )
      : fields;

    res.json({
      success: true,
      totalFields: fields.length,
      filteredCount: filteredFields.length,
      searchTerm: searchTerm || 'all fields',
      fields: filteredFields,
    });
  } catch (error) {
    console.error('Salesforce describe error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to describe Opportunity object in Salesforce.',
    });
  }
});

export default router;
