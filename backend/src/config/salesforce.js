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
