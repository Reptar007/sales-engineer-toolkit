/**
 * The single goal-eligibility predicate, covering both axes together.
 *
 * The `C-` cases below are the regression: the report route and the pack
 * roll-up used an exact `accountScore !== 'C'` that let `C-` through, while the
 * PDF and the Trophies page excluded it -- so the dashboard and the PDF could
 * print different CARR for the same quarter.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCScore,
  isGoalEligible,
  tagOpportunities,
  summarizeQuarter,
  typeBucket,
} from '../src/projects/salesforce/goalEligibility.js';
import { GOAL_INCLUSION_EXCEPTIONS } from '../src/projects/salesforce/goalExceptions.js';

const Q2_2026 = { year: 2026, quarter: 2 };
const Q3_2026 = { year: 2026, quarter: 3 };

const row = (over = {}) => ({
  opportunityName: 'Acme Corp',
  opportunityId: '006AAAAAAAAAAAAAAA',
  accountScore: 'A',
  type: 'New Business',
  carrAmount: 100000,
  ...over,
});

describe('account score axis', () => {
  test('plain C is excluded', () => {
    assert.equal(isCScore(row({ accountScore: 'C' })), true);
    assert.equal(isGoalEligible(row({ accountScore: 'C' }), Q2_2026), false);
  });

  test('"C-" and "C " variants are excluded too', () => {
    // The bug: an exact `!== 'C'` check treated these as eligible.
    assert.equal(isCScore(row({ accountScore: 'C-' })), true);
    assert.equal(isCScore(row({ accountScore: 'C ' })), true);
    assert.equal(isGoalEligible(row({ accountScore: 'C-' }), Q2_2026), false);
  });

  test('an empty account score counts (2025 reports have no such column)', () => {
    assert.equal(isCScore(row({ accountScore: '' })), false);
    assert.equal(isGoalEligible(row({ accountScore: '' }), Q2_2026), true);
  });

  test('a C-scored opp with an explicit exception counts', () => {
    const exception = GOAL_INCLUSION_EXCEPTIONS[0];
    const excepted = row({ accountScore: 'C', opportunityId: exception.opportunityId });
    assert.equal(isCScore(excepted), false);
    assert.equal(isGoalEligible(excepted, Q2_2026), true);
  });
});

describe('the two axes are independent', () => {
  test('an exception does not override the type rule', () => {
    // The exception is about Account Score. An Expansion deal in a
    // New-Business-only quarter is still out.
    const exception = GOAL_INCLUSION_EXCEPTIONS[0];
    const excepted = row({
      accountScore: 'C',
      type: 'Expansion',
      opportunityId: exception.opportunityId,
    });
    assert.equal(isGoalEligible(excepted, Q2_2026), false);
    assert.equal(isGoalEligible(excepted, Q3_2026), true);
  });

  test('a good score does not rescue an out-of-composition type', () => {
    assert.equal(isGoalEligible(row({ accountScore: 'A', type: 'Expansion' }), Q2_2026), false);
  });

  test('an in-composition type does not rescue a C score', () => {
    assert.equal(isGoalEligible(row({ accountScore: 'C', type: 'Expansion' }), Q3_2026), false);
  });
});

describe('tagOpportunities', () => {
  test('canonicalises type and stamps goalEligible without mutating input', () => {
    const input = [row({ type: 'upsell' })];
    const frozen = { ...input[0] };
    const tagged = tagOpportunities(input, Q3_2026);

    assert.equal(tagged[0].type, 'Expansion');
    assert.equal(tagged[0].goalEligible, true);
    assert.deepEqual(input[0], frozen, 'input row must not be mutated');
  });

  test('the same rows tag differently either side of the cutover', () => {
    const rows = [row({ type: 'Expansion' })];
    assert.equal(tagOpportunities(rows, Q2_2026)[0].goalEligible, false);
    assert.equal(tagOpportunities(rows, Q3_2026)[0].goalEligible, true);
  });

  test('tolerates a non-array', () => {
    assert.deepEqual(tagOpportunities(undefined, Q3_2026), []);
  });
});

describe('summarizeQuarter', () => {
  const rows = [
    row({ opportunityId: '1', type: 'New Business', carrAmount: 500000 }),
    row({ opportunityId: '2', type: 'Expansion', carrAmount: 200000 }),
    row({ opportunityId: '3', type: 'Expansion', carrAmount: 50000 }),
    row({ opportunityId: '4', type: 'New Business', carrAmount: 900000, accountScore: 'C' }),
    row({ opportunityId: '5', type: 'Renewal', carrAmount: 300000 }),
  ];

  test('post-cutover: counts NB + Expansion, drops C and Renewal', () => {
    const summary = summarizeQuarter(tagOpportunities(rows, Q3_2026), Q3_2026);
    assert.equal(summary.totalCARR, 750000);
    assert.equal(summary.eligibleCount, 3);
    assert.equal(summary.excludedCount, 2);
    assert.deepEqual(summary.carrByType, { 'New Business': 500000, Expansion: 250000 });
  });

  test('pre-cutover: the same rows yield New Business only', () => {
    const summary = summarizeQuarter(tagOpportunities(rows, Q2_2026), Q2_2026);
    assert.equal(summary.totalCARR, 500000);
    assert.deepEqual(summary.carrByType, { 'New Business': 500000 });
  });

  test('the per-type split always reconciles to the headline total', () => {
    // This is the invariant every split bar in the UI depends on.
    for (const period of [Q2_2026, Q3_2026]) {
      const summary = summarizeQuarter(tagOpportunities(rows, period), period);
      const sum = Object.values(summary.carrByType).reduce((a, b) => a + b, 0);
      assert.equal(sum, summary.totalCARR);
    }
  });

  test('untyped rows land in their own bucket rather than a stream', () => {
    const untyped = [row({ type: '', carrAmount: 1000 })];
    const summary = summarizeQuarter(tagOpportunities(untyped, Q3_2026), Q3_2026);
    assert.deepEqual(summary.carrByType, { Unspecified: 1000 });
    assert.equal(typeBucket({ type: '' }), 'Unspecified');
  });
});
