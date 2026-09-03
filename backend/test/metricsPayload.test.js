/**
 * The acceptance criterion for the whole Expansion cutover, as a test:
 *
 *   Q1 and Q2 CY2026 totals are identical before and after, to the cent.
 *   Q3 increases by exactly the sum of goal-eligible Expansion CARR.
 *
 * "Before" is modelled as the payload shape that shipped previously: rows with
 * no Type column at all. "After" is the same closed-won deals plus the
 * Expansion rows the updated Salesforce report now returns.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  decorateMetricsPayload,
  decorateCalculatorPayload,
} from '../src/projects/salesforce/metricsPayload.js';

const opp = (id, carrAmount, over = {}) => ({
  opportunityId: id,
  opportunityName: `Deal ${id}`,
  aeName: 'Dana Reyes',
  aeId: '005AE',
  accountScore: 'A',
  carrAmount,
  ...over,
});

// The New Business book, unchanged by the policy change. No `type` field --
// exactly how rows looked before Opportunity Type was added to the report.
const NEW_BUSINESS = {
  'Q1 CY2026': [opp('nb1', 400000), opp('nb2', 250000)],
  'Q2 CY2026': [opp('nb3', 600000), opp('nb4', 125000.55)],
  'Q3 CY2026': [opp('nb5', 300000)],
};

// The Expansion rows the report started returning after the SF change.
const EXPANSION = {
  'Q1 CY2026': [opp('ex1', 90000, { type: 'Expansion' })],
  'Q2 CY2026': [opp('ex2', 175000, { type: 'Expansion' })],
  'Q3 CY2026': [
    opp('ex3', 220000, { type: 'Expansion' }),
    opp('ex4', 80000, { type: 'Expansion' }),
    // A C-scored Expansion deal: excluded on the score axis even post-cutover.
    opp('ex5', 500000, { type: 'Expansion', accountScore: 'C' }),
  ],
};

function payloadFrom(buckets) {
  const quarterlyData = {};
  const allOpportunities = [];
  for (const [quarter, rows] of Object.entries(buckets)) {
    const withQuarter = rows.map((row) => ({ ...row, quarter }));
    quarterlyData[quarter] = { quarter, opportunities: withQuarter };
    allOpportunities.push(...withQuarter);
  }
  return { quarterlyData, allOpportunities };
}

const before = decorateMetricsPayload(payloadFrom(NEW_BUSINESS));

const merged = Object.fromEntries(
  Object.entries(NEW_BUSINESS).map(([quarter, rows]) => [
    quarter,
    // Post-change the report tags New Business explicitly too.
    [...rows.map((row) => ({ ...row, type: 'New Business' })), ...(EXPANSION[quarter] || [])],
  ]),
);
const after = decorateMetricsPayload(payloadFrom(merged));

describe('past quarters must not move', () => {
  for (const quarter of ['Q1 CY2026', 'Q2 CY2026']) {
    test(`${quarter} total is unchanged to the cent`, () => {
      assert.equal(after.quarterlyData[quarter].totalCARR, before.quarterlyData[quarter].totalCARR);
    });

    test(`${quarter} opportunity count is unchanged`, () => {
      assert.equal(
        after.quarterlyData[quarter].opportunityCount,
        before.quarterlyData[quarter].opportunityCount,
      );
    });

    test(`${quarter} reports New Business only`, () => {
      assert.equal(after.quarterlyData[quarter].composition.label, 'New Business');
      assert.deepEqual(Object.keys(after.quarterlyData[quarter].carrByType), ['New Business']);
    });
  }

  test('Q2 keeps its fractional cents exactly', () => {
    assert.equal(after.quarterlyData['Q2 CY2026'].totalCARR, 725000.55);
  });

  test('the excluded Expansion rows are still returned, just not counted', () => {
    const q1 = after.quarterlyData['Q1 CY2026'];
    assert.equal(q1.opportunities.length, 3, 'all rows present for display');
    assert.equal(q1.excludedCount, 1);
    assert.equal(q1.opportunities.find((o) => o.opportunityId === 'ex1').goalEligible, false);
  });
});

describe('the cutover quarter', () => {
  test('Q3 rises by exactly the goal-eligible Expansion CARR', () => {
    const q3Before = before.quarterlyData['Q3 CY2026'].totalCARR;
    const q3After = after.quarterlyData['Q3 CY2026'].totalCARR;
    // ex3 + ex4; ex5 is C-scored and stays out.
    assert.equal(q3After - q3Before, 300000);
  });

  test('Q3 reports both streams, and they reconcile to the total', () => {
    const q3 = after.quarterlyData['Q3 CY2026'];
    assert.equal(q3.composition.label, 'New Business + Expansion');
    assert.deepEqual(q3.carrByType, { 'New Business': 300000, Expansion: 300000 });
    const sum = Object.values(q3.carrByType).reduce((a, b) => a + b, 0);
    assert.equal(sum, q3.totalCARR);
  });

  test('the C-scored Expansion deal is excluded even post-cutover', () => {
    const q3 = after.quarterlyData['Q3 CY2026'];
    assert.equal(q3.opportunities.find((o) => o.opportunityId === 'ex5').goalEligible, false);
    assert.equal(q3.excludedCount, 1);
  });
});

describe('year roll-up', () => {
  test('Total is the sum of the decorated quarters, not a raw sum', () => {
    const { quarterlyData } = after;
    const expected = ['Q1 CY2026', 'Q2 CY2026', 'Q3 CY2026'].reduce(
      (sum, key) => sum + quarterlyData[key].totalCARR,
      0,
    );
    assert.equal(quarterlyData.Total.totalCARR, expected);
  });

  test('a year spanning the cutover is flagged as mixed', () => {
    // The yearly figure now sums two different definitions of "counts toward
    // goal", so the UI needs to know not to present it as a like-for-like.
    assert.equal(after.quarterlyData.Total.mixedComposition, true);
    assert.equal(after.mixedComposition, true);
  });

  test('a pre-cutover-only year is not flagged', () => {
    const y2025 = decorateMetricsPayload(
      payloadFrom({ 'Q1 CY2025': [opp('a', 100)], 'Q2 CY2025': [opp('b', 200)] }),
    );
    assert.equal(y2025.mixedComposition, false);
  });
});

describe('legacy snapshots', () => {
  test('a 2025 payload with no types or scores is untouched', () => {
    const raw = { 'Q4 CY2025': [opp('l1', 111111.11), opp('l2', 222222.22, { accountScore: '' })] };
    const decorated = decorateMetricsPayload(payloadFrom(raw));
    const q4 = decorated.quarterlyData['Q4 CY2025'];
    assert.equal(q4.totalCARR, 333333.33);
    assert.equal(q4.excludedCount, 0);
    assert.deepEqual(q4.carrByType, { Unspecified: 333333.33 });
  });

  test('decoration is idempotent', () => {
    const once = decorateMetricsPayload(payloadFrom(merged));
    const twice = decorateMetricsPayload(once);
    assert.equal(
      twice.quarterlyData['Q3 CY2026'].totalCARR,
      after.quarterlyData['Q3 CY2026'].totalCARR,
    );
    // Q3: nb5 + ex3 + ex4 + ex5 = 4 rows, all still present after re-decorating.
    assert.equal(twice.quarterlyData['Q3 CY2026'].opportunities.length, 4);
  });

  test('a payload with no quarterlyData passes through', () => {
    assert.deepEqual(decorateMetricsPayload({}), {});
  });
});

describe('calculator payload', () => {
  // The High Probability report is open pipeline, so no goal-eligibility rule
  // applies -- every row stays selectable. All the decoration does is
  // canonicalise Type and total the pipeline per stream.
  const pipeline = () => ({
    data: [
      { opportunityId: 'p1', type: 'New Business', carrAmount: 300000, probability: 90 },
      { opportunityId: 'p2', type: 'upsell', carrAmount: 120000, probability: 80 },
      { opportunityId: 'p3', type: 'Expansion', carrAmount: 80000, probability: 75 },
      { opportunityId: 'p4', type: '', carrAmount: 50000, probability: 70 },
    ],
  });

  test('canonicalises type without dropping any row', () => {
    const decorated = decorateCalculatorPayload(pipeline());
    assert.equal(decorated.data.length, 4, 'pipeline rows are never filtered');
    assert.equal(decorated.data[1].type, 'Expansion', '"upsell" normalises to Expansion');
  });

  test('totals the pipeline per stream', () => {
    const decorated = decorateCalculatorPayload(pipeline());
    assert.deepEqual(decorated.carrByType, {
      'New Business': 300000,
      Expansion: 200000,
      Unspecified: 50000,
    });
    assert.deepEqual(decorated.countByType, {
      'New Business': 1,
      Expansion: 2,
      Unspecified: 1,
    });
  });

  test('the split reconciles to the pipeline total', () => {
    const decorated = decorateCalculatorPayload(pipeline());
    const sum = Object.values(decorated.carrByType).reduce((a, b) => a + b, 0);
    const total = decorated.data.reduce((acc, o) => acc + o.carrAmount, 0);
    assert.equal(sum, total);
  });

  test('leaves a payload with no data alone', () => {
    assert.deepEqual(decorateCalculatorPayload({}), {});
    assert.deepEqual(decorateCalculatorPayload({ data: 'nope' }), { data: 'nope' });
  });
});
