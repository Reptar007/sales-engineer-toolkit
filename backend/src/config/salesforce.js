import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve1PasswordValue } from '../projects/salesforce/functions.js';

// set up env processing
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

function parseSnapshotYears() {
  const raw = process.env.SNAPSHOT_YEARS || '2025';
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

/** Standard custom field for Gross ARR on Opportunity (report column “Gross ARR”). */
export const OPPORTUNITY_GROSS_ARR_FIELD = 'Gross_ARR__c';

/**
 * Env: SALESFORCE_OPPORTUNITY_CARR_FIELD — API name of the field that holds **CARR** (often different from Gross ARR).
 * If unset, lookup returns `grossARR` but `carr` is null so we never label Gross ARR as CARR.
 * Find the name: Setup → Opportunity → Fields, or GET /api/salesforce/opportunity/fields?search=carr
 */
export function getOpportunityCarrFieldApiName() {
  const raw = (process.env.SALESFORCE_OPPORTUNITY_CARR_FIELD || '').trim();
  if (!raw) return null;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return null;
  return raw;
}

export function getSalesforceConfig() {
  const calculatorReportId = resolve1PasswordValue(
    process.env.SALESFORCE_REPORT_ID_CALCULATOR || '',
  );
  const metrics2025 = resolve1PasswordValue(
    process.env.SALESFORCE_REPORT_ID_METRICS_2025 || '00OPA000002sLkf2AE',
  );
  const metrics2026 = resolve1PasswordValue(
    process.env.SALESFORCE_REPORT_ID_METRICS_2026 || '00OPA000003MLAX2A4',
  );

  return {
    opportunityCarrFieldApiName: getOpportunityCarrFieldApiName(),
    reportIdsByYear: {
      2025: {
        metrics: metrics2025,
        calculator: calculatorReportId,
      },
      2026: {
        metrics: metrics2026,
        calculator: calculatorReportId,
      },
    },
    goalsByYear: {
      2025: [
        { value: 1, label: 'Q1 CY2025', goal: 1900000 },
        { value: 2, label: 'Q2 CY2025', goal: 2520000 },
        { value: 3, label: 'Q3 CY2025', goal: 2500000 },
        { value: 4, label: 'Q4 CY2025', goal: 3560000 },
      ],
      2026: [
        { value: 1, label: 'Q1 CY2026', goal: 0 },
        { value: 2, label: 'Q2 CY2026', goal: 0 },
        { value: 3, label: 'Q3 CY2026', goal: 0 },
        { value: 4, label: 'Q4 CY2026', goal: 0 },
      ],
    },
    snapshotYears: parseSnapshotYears(),
  };
}
