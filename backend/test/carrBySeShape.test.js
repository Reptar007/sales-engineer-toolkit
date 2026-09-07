/**
 * Column resolution for the "All Closed Won" report.
 *
 * This report is read to decide which SE is credited with a deal's CARR, so a
 * mis-resolved column doesn't just show a wrong number -- it attributes real
 * revenue to the wrong person. Unlike the metrics report there is no historical
 * layout to reproduce, so resolution here is name-only and a failure must throw
 * rather than fall back to a guess. These cover both halves of that.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCarrBySeColumns,
  parseCarrBySeRow,
  fiscalYearForKey,
  readDetailColumns,
} from '../src/projects/salesforce/carrBySeShape.js';

// The live layout at time of writing.
const LIVE_COLUMNS = [
  ['ROLLUP_DESCRIPTION', 'Owner Role'],
  ['FULL_NAME', 'Opportunity Owner'],
  ['ACCOUNT_NAME', 'Account Name'],
  ['OPPORTUNITY_NAME', 'Opportunity Name'],
  ['STAGE_NAME', 'Stage'],
  ['FISCAL_QUARTER', 'Fiscal Period'],
  ['CLOSE_DATE', 'Close Date'],
  ['TYPE', 'Type'],
  ['Opportunity.ARR__c', 'CARR'],
];

/** Build a report result carrying the given [apiName, label] columns. */
function reportWith(columns) {
  return {
    reportMetadata: { detailColumns: columns.map(([apiName]) => apiName) },
    reportExtendedMetadata: {
      detailColumnInfo: Object.fromEntries(
        columns.map(([apiName, label]) => [apiName, { label, dataType: 'string' }]),
      ),
    },
  };
}

const liveRow = [
  { label: 'AE', value: 'AE' },
  { label: 'Devin Steinke', value: '0055f00000AakC6AAJ' },
  { label: 'Signant Health', value: '0015f00000GqefZAAR' },
  { label: 'Signant Health', value: '006PA00000UyepJYAR' },
  { label: 'Closed Won', value: 'Closed Won' },
  { label: 'Q3-2026', value: 'Q3-2026' },
  { label: '8/21/2026', value: '2026-08-21' },
  { label: 'New Business', value: 'New Business' },
  { label: '$77,400.00', value: { amount: 77400, currency: null } },
];

describe('resolveCarrBySeColumns', () => {
  test('resolves every column of the live layout by name', () => {
    const cols = resolveCarrBySeColumns(reportWith(LIVE_COLUMNS));
    assert.equal(cols.ownerRole, 0);
    assert.equal(cols.ownerName, 1);
    assert.equal(cols.accountName, 2);
    assert.equal(cols.opportunityName, 3);
    assert.equal(cols.stage, 4);
    assert.equal(cols.fiscalPeriod, 5);
    assert.equal(cols.closeDate, 6);
    assert.equal(cols.type, 7);
    assert.equal(cols.carr, 8);
  });

  test('follows a reordered report instead of assuming positions', () => {
    // Someone drags CARR to the front in Salesforce. Positional reading would
    // hand back Owner Role as the amount; name resolution has to track it.
    const reordered = [LIVE_COLUMNS[8], ...LIVE_COLUMNS.slice(0, 8)];
    const cols = resolveCarrBySeColumns(reportWith(reordered));
    assert.equal(cols.carr, 0);
    assert.equal(cols.ownerRole, 1);
    assert.equal(cols.opportunityName, 4);
  });

  test('throws when a required column is missing rather than guessing', () => {
    const withoutCarr = LIVE_COLUMNS.filter(([apiName]) => apiName !== 'Opportunity.ARR__c');
    assert.throws(
      () => resolveCarrBySeColumns(reportWith(withoutCarr)),
      (error) => {
        assert.equal(error.code, 'REPORT_SHAPE');
        assert.match(error.message, /carr/i);
        return true;
      },
    );
  });

  test('throws when the report carries no column metadata', () => {
    assert.throws(
      () => resolveCarrBySeColumns({ factMap: {} }),
      (error) => {
        assert.equal(error.code, 'REPORT_SHAPE');
        return true;
      },
    );
  });

  test('optional columns resolve to -1 without failing the report', () => {
    // Owner Role, Stage and Type are context only; the page still works
    // without them, so their absence must not take the whole page down.
    const minimal = LIVE_COLUMNS.filter(([apiName]) =>
      ['FULL_NAME', 'OPPORTUNITY_NAME', 'FISCAL_QUARTER', 'Opportunity.ARR__c'].includes(apiName),
    );
    const cols = resolveCarrBySeColumns(reportWith(minimal));
    assert.equal(cols.ownerRole, -1);
    assert.equal(cols.stage, -1);
    assert.equal(cols.type, -1);
    assert.equal(cols.carr, 3);
  });
});

describe('parseCarrBySeRow', () => {
  const cols = resolveCarrBySeColumns(reportWith(LIVE_COLUMNS));

  test('reads the Salesforce opportunity id out of the name cell', () => {
    const parsed = parseCarrBySeRow(liveRow, cols, '2026');
    // The id is what every attribution is keyed on -- two opps can share a
    // name, so reading `value` and not `label` here is load-bearing.
    assert.equal(parsed.opportunityId, '006PA00000UyepJYAR');
    assert.equal(parsed.opportunityName, 'Signant Health');
  });

  test('reads the amount, period and owner', () => {
    const parsed = parseCarrBySeRow(liveRow, cols, '2026');
    assert.equal(parsed.carrAmount, 77400);
    assert.equal(parsed.carrAmountFormatted, '$77,400.00');
    assert.equal(parsed.fiscalPeriod, 'Q3-2026');
    assert.equal(parsed.fiscalYear, '2026');
    assert.equal(parsed.ownerName, 'Devin Steinke');
    assert.equal(parsed.closeDate, '2026-08-21');
  });

  test('an absent optional column reads as empty, not as another cell', () => {
    const parsed = parseCarrBySeRow(liveRow, { ...cols, type: -1 }, '2026');
    assert.equal(parsed.type, '');
  });

  test('a row with no amount is 0 rather than NaN', () => {
    const noAmount = [...liveRow];
    noAmount[8] = { label: '', value: null };
    assert.equal(parseCarrBySeRow(noAmount, cols, '2026').carrAmount, 0);
  });
});

describe('fiscalYearForKey', () => {
  const groupingsDown = {
    groupings: [
      { key: '0', label: '2021', value: 2021 },
      { key: '1', label: '2022', value: 2022 },
    ],
  };

  test('reads the label off the grouping, not the key ordinal', () => {
    assert.equal(fiscalYearForKey('1!T', groupingsDown), '2022');
  });

  test('the grand-total bucket has no year', () => {
    assert.equal(fiscalYearForKey('T!T', groupingsDown), '');
  });

  test('an unknown key yields empty rather than a wrong year', () => {
    assert.equal(fiscalYearForKey('9!T', groupingsDown), '');
  });
});

describe('readDetailColumns', () => {
  test('returns null when the result carries no column metadata', () => {
    assert.equal(readDetailColumns({}), null);
    assert.equal(readDetailColumns({ reportMetadata: { detailColumns: [] } }), null);
  });
});
