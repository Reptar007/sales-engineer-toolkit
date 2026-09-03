/**
 * Column resolution. Adding a column to the metrics report is the operation
 * that has historically corrupted numbers here (the 2026 Account Score
 * insertion shifted CARR by one), so these cover both the name-based path and
 * the positional fallback it degrades to.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMetricsColumns,
  parseMetricsRow,
  detectHasAccountScore,
  getMetricsColumnIndices,
} from '../src/projects/salesforce/reportShape.js';

// A cell as the Analytics API emits it.
const cell = (label, amount) => (amount === undefined ? { label } : { label, value: amount });
const money = (amount) => ({ label: `$${amount}.00`, value: { amount } });

// 2026 layout: AE, Opp, Sales Score, Account Score, Effective Date, Gross, CARR
const row2026 = [
  { label: 'Dana Reyes', value: '005AE' },
  { label: 'Acme Corp', value: '006OPP' },
  cell('B'),
  cell('A'),
  cell('3/14/2026'),
  money(90000),
  money(120000),
];

// 2025 layout: no Account Score column
const row2025 = [
  { label: 'Dana Reyes', value: '005AE' },
  { label: 'Acme Corp', value: '006OPP' },
  cell('B'),
  cell('3/14/2025'),
  money(90000),
  money(120000),
];

const factMapOf = (cells) => ({ '0!T': { rows: [{ dataCells: cells }] } });

describe('positional fallback (no column metadata)', () => {
  test('reads the 2026 seven-column layout', () => {
    const result = { factMap: factMapOf(row2026) };
    const cols = resolveMetricsColumns(result);
    assert.equal(cols.source, 'positional');

    const parsed = parseMetricsRow(row2026, cols, 'Q1 CY2026');
    assert.equal(parsed.aeName, 'Dana Reyes');
    assert.equal(parsed.accountScore, 'A');
    assert.equal(parsed.effectiveDate, '3/14/2026');
    assert.equal(parsed.carrAmount, 120000);
    assert.equal(parsed.grossARRAmount, 90000);
    assert.equal(parsed.type, '', 'no Type column yet');
  });

  test('reads the 2025 six-column layout without shifting CARR', () => {
    const result = { factMap: factMapOf(row2025) };
    const cols = resolveMetricsColumns(result);
    assert.equal(detectHasAccountScore(result.factMap), false);

    const parsed = parseMetricsRow(row2025, cols, 'Q1 CY2025');
    assert.equal(parsed.accountScore, '', 'no Account Score column in 2025');
    assert.equal(parsed.effectiveDate, '3/14/2025');
    assert.equal(parsed.carrAmount, 120000);
  });

  test('an APPENDED Type column is picked up and leaves CARR in place', () => {
    // Appending is the documented way to add Type precisely because indices
    // 0..carr do not move.
    const appended = [...row2026, cell('Expansion')];
    const result = { factMap: factMapOf(appended) };
    const cols = resolveMetricsColumns(result);

    assert.equal(cols.type, 7);
    const parsed = parseMetricsRow(appended, cols, 'Q3 CY2026');
    assert.equal(parsed.type, 'Expansion');
    assert.equal(parsed.carrAmount, 120000, 'CARR must not shift');
    assert.equal(parsed.accountScore, 'A');
  });

  test('an empty report does not promote itself to the newer layout', () => {
    assert.equal(detectHasAccountScore({}), false);
    assert.equal(getMetricsColumnIndices(false).accountScore, -1);
  });
});

describe('name-based resolution (column metadata present)', () => {
  const metadataResult = {
    factMap: factMapOf(row2026),
    reportMetadata: {
      detailColumns: [
        'OPPORTUNITY.ACCOUNT_EXECUTIVE',
        'OPPORTUNITY_NAME',
        'Sales_Score__c',
        'Account_Score__c',
        'CLOSE_DATE',
        'Gross_ARR__c',
        'CARR__c',
      ],
    },
    reportExtendedMetadata: {
      detailColumnInfo: {
        'OPPORTUNITY.ACCOUNT_EXECUTIVE': { label: 'AE Name' },
        OPPORTUNITY_NAME: { label: 'Opportunity Name' },
        Sales_Score__c: { label: 'Sales Score' },
        Account_Score__c: { label: 'Account Score' },
        CLOSE_DATE: { label: 'Effective Date' },
        Gross_ARR__c: { label: 'Gross ARR' },
        CARR__c: { label: 'CARR' },
      },
    },
  };

  test('resolves every column by label', () => {
    const cols = resolveMetricsColumns(metadataResult);
    assert.equal(cols.source, 'metadata');
    assert.equal(cols.aeName, 0);
    assert.equal(cols.opportunityName, 1);
    assert.equal(cols.accountScore, 3);
    assert.equal(cols.effectiveDate, 4);
    assert.equal(cols.grossARR, 5);
    assert.equal(cols.carr, 6);
  });

  test('agrees with the positional map on the same report', () => {
    // The refactor must be a no-op on today's reports -- that is the whole
    // acceptance criterion for landing it on its own.
    const byName = resolveMetricsColumns(metadataResult);
    const positional = getMetricsColumnIndices(true);
    for (const key of Object.keys(positional)) {
      assert.equal(byName[key], positional[key], `column ${key} must agree`);
    }
  });

  test('finds Type wherever it sits, even INSERTED mid-report', () => {
    // Name resolution is what makes an inserted column survivable rather than
    // silently corrupting every figure after it.
    const inserted = {
      factMap: factMapOf([
        row2026[0],
        row2026[1],
        cell('Expansion'),
        row2026[2],
        row2026[3],
        row2026[4],
        row2026[5],
        row2026[6],
      ]),
      reportMetadata: {
        detailColumns: [
          'OPPORTUNITY.ACCOUNT_EXECUTIVE',
          'OPPORTUNITY_NAME',
          'TYPE',
          'Sales_Score__c',
          'Account_Score__c',
          'CLOSE_DATE',
          'Gross_ARR__c',
          'CARR__c',
        ],
      },
      reportExtendedMetadata: {
        detailColumnInfo: {
          ...metadataResult.reportExtendedMetadata.detailColumnInfo,
          TYPE: { label: 'Type' },
        },
      },
    };

    const cols = resolveMetricsColumns(inserted);
    assert.equal(cols.source, 'metadata');
    assert.equal(cols.type, 2);
    assert.equal(cols.carr, 7);

    const parsed = parseMetricsRow(inserted.factMap['0!T'].rows[0].dataCells, cols, 'Q3 CY2026');
    assert.equal(parsed.type, 'Expansion');
    assert.equal(parsed.carrAmount, 120000, 'CARR still correct despite the insertion');
  });

  test('incomplete metadata degrades to positional rather than guessing', () => {
    const partial = {
      factMap: factMapOf(row2026),
      reportMetadata: { detailColumns: ['OPPORTUNITY_NAME', 'MYSTERY_A', 'MYSTERY_B'] },
      reportExtendedMetadata: {
        detailColumnInfo: { OPPORTUNITY_NAME: { label: 'Opportunity Name' } },
      },
    };
    assert.equal(resolveMetricsColumns(partial).source, 'positional');
  });

  test('ambiguous metadata (two columns matching one role) degrades too', () => {
    const ambiguous = {
      factMap: factMapOf(row2026),
      reportMetadata: { detailColumns: ['A', 'B', 'C', 'D', 'E', 'F'] },
      reportExtendedMetadata: {
        detailColumnInfo: {
          A: { label: 'AE Name' },
          B: { label: 'Opportunity Name' },
          C: { label: 'Sales Score' },
          D: { label: 'Effective Date' },
          E: { label: 'CARR' },
          F: { label: 'CARR' },
        },
      },
    };
    // Gross ARR is missing and CARR is duplicated -- don't trust it.
    assert.equal(resolveMetricsColumns(ambiguous).source, 'positional');
  });
});
