import express from 'express';
import {
  getSalesforceConnection,
  getQuarterName,
  readSnapshotRegistry,
  SNAPSHOTS_DIR,
} from './functions.js';
import { createSnapshotForYear } from './snapshotService.js';
import { getGoalsByYearFromDb } from './goalsService.js';
import { authenticateToken } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { getSalesforceConfig } from '../../config/salesforce.js';
import { readFileSync } from 'fs';

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
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to connect to Salesforce. Please check your credentials.',
    });
  }
});

// Get SF config
router.get(`/config`, authenticateToken, async (req, res) => {
  try {
    const config = getSalesforceConfig();
    const dbGoalsByYear = await getGoalsByYearFromDb();

    // DB goals override fallback config goals for matching years.
    config.goalsByYear = {
      ...(config.goalsByYear || {}),
      ...dbGoalsByYear,
    };

    return res.json(config);
  } catch (error) {
    console.error('Failed to load Salesforce config goals:', error);
    return res.status(500).json({ error: 'Failed to load Salesforce config' });
  }
});

// Get data from a specific report (protected - requires authentication)
router.get('/report/:reportId', authenticateToken, async (req, res) => {
  const { reportId } = req.params;
  const config = getSalesforceConfig();
  const metricsReportIds = Object.values(config.reportIdsByYear || {})
    .map((r) => r.metrics)
    .filter(Boolean);
  const calculatorReportIds = Object.values(config.reportIdsByYear || {})
    .map((r) => r.calculator)
    .filter(Boolean);

  try {
    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    // Use the Reports API to get the actual report data
    const result = await conn.analytics.report(reportId).execute({
      details: true,
    });

    if (metricsReportIds.includes(reportId)) {
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
    } else if (calculatorReportIds.includes(reportId)) {
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
    } else {
      res.status(400).json({
        success: false,
        error: 'Unknown report type',
        details:
          'Report ID is not configured as a metrics or calculator report. Add it to reportIdsByYear in config.',
      });
    }
  } catch (error) {
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
        Competition__c,
        Current_QA_Setup__c,
         Company_Size__c,
         Headcount_Range__c,
         Gong__Gong_Count__c,
         Gong_Last_Meeting_Date__c,
         Gong_Days_Since_Last_Meeting__c,
         Gong_Count_of_Meetings__c,
         Champion__c,
         Champion_Contact__c,
         Champion_Contact__r.Name,
         Blockers_Product_Gaps__c
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
        competitor: record.Competition__c || '',
        currentQASetup: record.Current_QA_Setup__c || '',
        companySize: record.Company_Size__c || null,
        headcountRange: record.Headcount_Range__c || '',
        gongCount: record.Gong__Gong_Count__c || null,
        gongLastMeetingDate: record.Gong_Last_Meeting_Date__c || null,
        gongDaysSinceLastMeeting: record.Gong_Days_Since_Last_Meeting__c || null,
        gongCountOfMeetings: record.Gong_Count_of_Meetings__c || null,
        champion: record.Champion__c || '',
        championContactId: record.Champion_Contact__c || '',
        championContactName: record.Champion_Contact__r?.Name || '',
        blockers: record.Blockers_Product_Gaps__c || '',
      };
    });

    // Return success response
    res.json({
      success: true,
      count: transformedData.length,
      data: transformedData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to search opportunities in Salesforce. Please try again later.',
    });
  }
});

// Discover Gong object structure
router.get('/gong/discover', authenticateToken, async (req, res) => {
  try {
    // Create connection for each request
    if (!conn) {
      conn = await getSalesforceConnection();
    }

    // Query for all custom objects that might be Gong-related
    const allObjects = await conn.describeGlobal();
    const gongObjects = allObjects.sobjects.filter(
      (obj) => obj.name.toLowerCase().includes('gong') && obj.custom,
    );

    const discoveredObjects = [];

    for (const obj of gongObjects) {
      try {
        const metadata = await conn.sobject(obj.name).describe();

        // Find relationship fields that might link to Opportunity
        const relationshipFields = metadata.fields.filter((field) => field.type === 'reference');

        // Find fields that might contain conversation data
        const dataFields = metadata.fields.filter(
          (field) =>
            field.name.toLowerCase().includes('title') ||
            field.name.toLowerCase().includes('duration') ||
            field.name.toLowerCase().includes('name') ||
            field.type === 'string' ||
            field.type === 'double' ||
            field.type === 'int',
        );

        discoveredObjects.push({
          objectName: obj.name,
          label: obj.label,
          fields: metadata.fields.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            referenceTo: f.referenceTo || [],
            relationshipName: f.relationshipName || null,
          })),
          relationshipFields: relationshipFields.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            referenceTo: f.referenceTo || [],
            relationshipName: f.relationshipName || null,
          })),
          potentialDataFields: dataFields.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
          })),
        });
        // eslint-disable-next-line no-unused-vars
      } catch (err) {
        // Error describing object, skip it
      }
    }

    res.json({
      success: true,
      count: discoveredObjects.length,
      objects: discoveredObjects,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to discover Gong objects.',
    });
  }
});

// Get Gong conversations for an opportunity
router.get(
  '/opportunity/:opportunityId/gong-conversations',
  authenticateToken,
  async (req, res) => {
    try {
      const { opportunityId } = req.params;

      if (!opportunityId) {
        return res.status(400).json({
          success: false,
          error: 'Opportunity ID is required',
        });
      }

      // Create connection for each request
      if (!conn) {
        conn = await getSalesforceConnection();
      }

      // Query Gong conversations related to this opportunity
      // Based on discovery, we know:
      // - Object: Gong__Gong_Call__c
      // - Relationship field: Gong__Primary_Opportunity__c
      // - Title: Gong__Title__c
      // - Duration: Gong__Call_Duration__c (string in MM:SS format) or Gong__Call_Duration_sec__c (seconds as double)
      // - Created: CreatedDate or Gong__Call_Start__c

      let result = { records: [], totalSize: 0 };

      try {
        result = await conn.query(
          `SELECT Id, Name, Gong__Title__c, Gong__Call_Duration__c, Gong__Call_Duration_sec__c, 
         Gong__Call_Start__c, Gong__View_call__c, CreatedDate, LastModifiedDate
         FROM Gong__Gong_Call__c 
         WHERE Gong__Primary_Opportunity__c = '${opportunityId.replace(/'/g, "\\'")}'
         ORDER BY CreatedDate DESC
         LIMIT 20`,
        );
        // eslint-disable-next-line no-unused-vars
      } catch (err) {
        result = { records: [], totalSize: 0 };
      }

      // Ensure result has records array
      if (!result.records) {
        result.records = [];
      }

      // Transform results - using the correct field names from discovery
      const conversations = (result.records || []).map((record) => {
        // Title: Use Gong__Title__c or fall back to Name
        const title = record.Gong__Title__c || record.Name || 'Untitled Conversation';

        // Duration: Prefer Gong__Call_Duration__c (string format like "48:04"),
        // otherwise use Gong__Call_Duration_sec__c (seconds) and convert to MM:SS
        let duration = null;
        if (record.Gong__Call_Duration__c) {
          duration = record.Gong__Call_Duration__c; // Already in MM:SS format
        } else if (record.Gong__Call_Duration_sec__c) {
          // Convert seconds to MM:SS format
          const totalSeconds = Math.round(record.Gong__Call_Duration_sec__c);
          const minutes = Math.floor(totalSeconds / 60);
          const seconds = totalSeconds % 60;
          duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        // Created date: Prefer Gong__Call_Start__c, otherwise CreatedDate
        const createdDate = record.Gong__Call_Start__c || record.CreatedDate || null;

        // Extract URL from Gong__View_call__c - it might be HTML, so extract the href
        let url = null;
        if (record.Gong__View_call__c) {
          const urlValue = record.Gong__View_call__c;
          // If it's HTML (contains <a> tag), extract the href attribute
          if (typeof urlValue === 'string' && urlValue.includes('<a')) {
            const hrefMatch = urlValue.match(/href=["']([^"']+)["']/);
            if (hrefMatch && hrefMatch[1]) {
              url = hrefMatch[1];
            } else {
              // Try to extract URL from text content
              const urlMatch = urlValue.match(/https?:\/\/[^\s<>"']+/);
              url = urlMatch ? urlMatch[0] : null;
            }
          } else {
            // It's already a plain URL string
            url = urlValue;
          }
        }

        return {
          id: record.Id || '',
          name: record.Name || '',
          title: title,
          duration: duration,
          createdDate: createdDate,
          lastModifiedDate: record.LastModifiedDate || null,
          url: url,
        };
      });

      // Always return success, even if no conversations found
      res.json({
        success: true,
        count: conversations.length,
        data: conversations,
      });
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      // Return empty result instead of error to prevent frontend issues
      res.json({
        success: true,
        count: 0,
        data: [],
      });
    }
  },
);

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
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to describe Opportunity object in Salesforce.',
    });
  }
});

router.get('/snapshot/:year', authenticateToken, async (req, res) => {
  const yearParam = req.params.year;
  const year = parseInt(yearParam, 10);
  if (Number.isNaN(year)) {
    return res.status(400).json({ error: 'Invalid year' });
  }

  const { years: snapshotYears } = readSnapshotRegistry();
  if (!snapshotYears.includes(year)) {
    return res.status(404).json({ error: `${year} is not in snapshot years` });
  }

  const filePath = `${SNAPSHOTS_DIR}/${year}-metrics.json`;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const payload = JSON.parse(raw);
    return res.json(payload);
  } catch {
    return res.status(404).json({ error: `Snapshot file not found for ${year}` });
  }
});

router.get('/snapshot/:year/calculator', authenticateToken, async (req, res) => {
  const yearParam = req.params.year;
  const year = parseInt(yearParam, 10);
  if (Number.isNaN(year)) {
    return res.status(400).json({ error: 'Invalid year' });
  }

  const { years: snapshotYears } = readSnapshotRegistry();
  if (!snapshotYears.includes(year)) {
    return res.status(404).json({ error: `${year} is not in snapshot years` });
  }

  const filePath = `${SNAPSHOTS_DIR}/${year}-calculator.json`;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const payload = JSON.parse(raw);
    return res.json(payload);
  } catch {
    return res.status(404).json({ error: `Snapshot file not found for ${year}` });
  }
});

router.post('/snapshot/:year', authenticateToken, requireRole('admin'), async (req, res) => {
  const yearParam = req.params.year;
  const year = parseInt(yearParam, 10);
  if (Number.isNaN(year)) {
    return res.status(400).json({ error: 'Invalid year' });
  }

  const config = getSalesforceConfig();
  const reportIds = config.reportIdsByYear[year];
  if (!reportIds?.metrics) {
    return res.status(400).json({
      error: `No report config for year ${year}. Set SALESFORCE_REPORT_ID_METRICS_${year} or add the year to config.`,
    });
  }

  try {
    const result = await createSnapshotForYear(year);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to create snapshot. Check Salesforce credentials and report access.',
    });
  }
});

export default router;
