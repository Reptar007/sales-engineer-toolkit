/**
 * Which opportunity types count toward the goal, per quarter.
 *
 * These assertions are the executable form of the policy: New Business only
 * before the Q3 CY2026 cutover, New Business + Expansion from it. If someone
 * changes COMPOSITION_CUTOVERS, this is what tells them which already-reported
 * quarters they just moved.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  countsTowardGoal,
  compositionFor,
  goalEligibleTypesFor,
  sameComposition,
  normalizeOppType,
  collectUnrecognizedTypes,
  OPP_TYPE_NEW_BUSINESS,
  OPP_TYPE_EXPANSION,
} from '../src/projects/salesforce/goalComposition.js';

const nb = { type: 'New Business' };
const expansion = { type: 'Expansion' };
const renewal = { type: 'Renewal' };
const untyped = { type: '' };

describe('composition by quarter', () => {
  test('Q1 and Q2 CY2026 count New Business only', () => {
    for (const quarter of [1, 2]) {
      const period = { year: 2026, quarter };
      assert.deepEqual(goalEligibleTypesFor(period), [OPP_TYPE_NEW_BUSINESS]);
      assert.equal(countsTowardGoal(nb, period), true);
      assert.equal(countsTowardGoal(expansion, period), false);
    }
  });

  test('Q3 CY2026 is the cutover -- Expansion starts counting', () => {
    const period = { year: 2026, quarter: 3 };
    assert.deepEqual(goalEligibleTypesFor(period), [OPP_TYPE_NEW_BUSINESS, OPP_TYPE_EXPANSION]);
    assert.equal(countsTowardGoal(nb, period), true);
    assert.equal(countsTowardGoal(expansion, period), true);
  });

  test('Q4 CY2026 and CY2027 stay combined', () => {
    assert.equal(countsTowardGoal(expansion, { year: 2026, quarter: 4 }), true);
    assert.equal(countsTowardGoal(expansion, { year: 2027, quarter: 1 }), true);
  });

  test('every quarter of 2025 stays New Business only', () => {
    for (const quarter of [1, 2, 3, 4]) {
      assert.equal(countsTowardGoal(expansion, { year: 2025, quarter }), false);
      assert.equal(countsTowardGoal(nb, { year: 2025, quarter }), true);
    }
  });

  test('renewals never count, on either side of the cutover', () => {
    assert.equal(countsTowardGoal(renewal, { year: 2026, quarter: 2 }), false);
    assert.equal(countsTowardGoal(renewal, { year: 2026, quarter: 3 }), false);
  });

  test('accepts a raw report label as the period', () => {
    assert.equal(countsTowardGoal(expansion, 'Q3 CY2026'), true);
    assert.equal(countsTowardGoal(expansion, 'Q2 CY2026'), false);
  });
});

describe('rows with no type', () => {
  test('count toward the goal in every quarter', () => {
    // 2025 snapshots and everything captured before the Type column was added
    // carry no type. Excluding these would zero out history.
    for (const period of [
      { year: 2025, quarter: 4 },
      { year: 2026, quarter: 1 },
      { year: 2026, quarter: 3 },
    ]) {
      assert.equal(countsTowardGoal(untyped, period), true);
    }
  });

  test('a missing type field behaves the same as an empty one', () => {
    assert.equal(countsTowardGoal({}, { year: 2026, quarter: 1 }), true);
    assert.equal(countsTowardGoal({ type: '   ' }, { year: 2026, quarter: 1 }), true);
  });
});

describe('type normalization', () => {
  test('canonicalises the expected picklist spellings', () => {
    assert.equal(normalizeOppType('New Business'), OPP_TYPE_NEW_BUSINESS);
    assert.equal(normalizeOppType('new business'), OPP_TYPE_NEW_BUSINESS);
    assert.equal(normalizeOppType('New Logo'), OPP_TYPE_NEW_BUSINESS);
    assert.equal(normalizeOppType('Expansion'), OPP_TYPE_EXPANSION);
    assert.equal(normalizeOppType('Existing Business - Expansion'), OPP_TYPE_EXPANSION);
    assert.equal(normalizeOppType('Upsell'), OPP_TYPE_EXPANSION);
    assert.equal(normalizeOppType('Cross-sell'), OPP_TYPE_EXPANSION);
  });

  test('never coerces an unknown value into a known type', () => {
    assert.equal(normalizeOppType('Partner Referral'), 'Partner Referral');
  });

  test('reports unrecognised values so a wrong guess is visible', () => {
    const rows = [nb, expansion, { type: 'Partner Referral' }, { type: '' }];
    assert.deepEqual(collectUnrecognizedTypes(rows), ['Partner Referral']);
  });
});

describe('comparability across the cutover', () => {
  test('quarters on the same side are comparable', () => {
    assert.equal(sameComposition({ year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }), true);
    assert.equal(sameComposition({ year: 2026, quarter: 3 }, { year: 2026, quarter: 4 }), true);
  });

  test('Q2 vs Q3 CY2026 is NOT comparable -- this is what suppresses the delta', () => {
    assert.equal(sameComposition({ year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }), false);
  });
});

describe('unparseable quarter labels', () => {
  test('fall back to the widest composition, never the narrowest', () => {
    // A label that stops matching should surface as a number that looks too
    // high and gets questioned, not as revenue silently disappearing.
    const composition = compositionFor('not a quarter');
    assert.deepEqual(composition.types, [OPP_TYPE_NEW_BUSINESS, OPP_TYPE_EXPANSION]);
    assert.equal(countsTowardGoal(expansion, 'not a quarter'), true);
  });
});
