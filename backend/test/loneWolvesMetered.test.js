/**
 * Lone Wolves AI credits: the by-week CSV of billing's Metronome script is
 * read into weekly totals for one environment, and the old price adds its
 * interactive minutes and AI credits ($0.15 a minute, $0.01 a credit; Anna,
 * 11/2). The new price stays run credits only.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeteredCsv, splitCsvLine } from '../src/projects/lone-wolves/meteredImport.js';
import { addMetered, priceUsage, shapeWeek } from '../src/projects/lone-wolves/usageShape.js';
import { meteredIndex, shapeRowUsage } from '../src/projects/lone-wolves/onboardingService.js';
import { OnboardingError } from '../src/projects/lone-wolves/workspaceStore.js';
import {
  describePrice,
  usageMessage,
} from '../../frontend/src/projects/lone-wolves/onboardingView.js';

const OCT_26 = Date.parse('2026-10-26T00:00:00Z');
const OCT_19 = Date.parse('2026-10-19T00:00:00Z');

const CSV = [
  'week_start,user,ai_credits,interactive_minutes,suite_minutes',
  '2026-10-19,ana@customer.com,100.5,20,30',
  '2026-10-19,(no user),10,0,5.25',
  '2026-10-19,(other environments),999,999,999',
  '2026-10-26,"Smith, J" <j@customer.com>,40,12.5,0',
  '',
].join('\n');

describe('reading the by-week CSV', () => {
  test('sums each week, keeps automatic work, drops other environments', () => {
    assert.deepEqual(parseMeteredCsv(CSV), [
      { weekStart: OCT_19, aiCredits: 110.5, interactiveMinutes: 20, suiteMinutes: 35.25 },
      { weekStart: OCT_26, aiCredits: 40, interactiveMinutes: 12.5, suiteMinutes: 0 },
    ]);
  });

  test('quoted fields keep their commas', () => {
    assert.deepEqual(splitCsvLine('a,"b, c","d ""e"""'), ['a', 'b, c', 'd "e"']);
  });

  test('a Windows file with a byte-order mark reads the same', () => {
    const windows = `\uFEFF${CSV.replace(/\n/g, '\r\n')}`;
    assert.deepEqual(parseMeteredCsv(windows), parseMeteredCsv(CSV));
  });

  test('refuses the per-user file, a non-Monday, a bad number and an empty file', () => {
    const bad = (text, pattern) =>
      assert.throws(
        () => parseMeteredCsv(text),
        (error) => error instanceof OnboardingError && pattern.test(error.message),
      );
    bad('user,ai_credits,interactive_minutes,suite_minutes\nx,1,2,3', /by-week/);
    bad(`${CSV.split('\n')[0]}\n2026-10-20,x,1,2,3`, /not a Monday/);
    bad(`${CSV.split('\n')[0]}\n2026-10-19,x,lots,2,3`, /ai_credits must be a number/);
    bad(`${CSV.split('\n')[0]}\n2026-10-19,(other environments),1,2,3`, /no weeks/);
    bad('', /empty/);
  });
});

describe('the old price with AI credits', () => {
  const usage = { credits: 44, runnerSeconds: 58.1 * 60 };
  const metered = { aiCredits: 2681, interactiveMinutes: 1054, suiteMinutes: 254 };

  test('suite and interactive minutes at $0.15, AI credits at $0.01', () => {
    const { old } = priceUsage(usage, metered);
    assert.deepEqual(old.parts, { suite: 8.72, interactive: 158.1, ai: 26.81 });
    assert.equal(old.amount, 193.63);
    assert.equal(old.excludesAiCredits, false);
  });

  test('the new price is run credits only, either way', () => {
    assert.deepEqual(priceUsage(usage, metered).new, priceUsage(usage).new);
  });

  test('a week shows what was imported for it, or null', () => {
    assert.equal(shapeWeek(OCT_26, { ...usage, runs: 1, flowRuns: 1, attempts: 1 }).metered, null);
    assert.equal(
      shapeWeek(OCT_26, { ...usage, runs: 1, flowRuns: 1, attempts: 1 }, metered).metered.aiCredits,
      2681,
    );
  });
});

describe('joining imports to a row', () => {
  const week = { runs: 1, flowRuns: 2, attempts: 2, runnerSeconds: 600, credits: 2 };
  const imported = [
    {
      workspaceId: 'w1',
      environmentId: 'e1',
      weekStart: new Date(OCT_19),
      aiCredits: 100,
      interactiveMinutes: 10,
      suiteMinutes: 9,
    },
    // Another environment of the same workspace never leaks in.
    {
      workspaceId: 'w1',
      environmentId: 'e2',
      weekStart: new Date(OCT_26),
      aiCredits: 5,
      interactiveMinutes: 5,
      suiteMinutes: 5,
    },
  ];
  const usage = {
    weeks: [
      { weekStart: OCT_26, usage: week },
      { weekStart: OCT_19, usage: week },
    ],
    sinceKickoff: true,
  };

  test('each week gets its own import; the total adds them and says how many weeks have one', () => {
    const shaped = shapeRowUsage(usage, meteredIndex(imported)('w1', 'e1'));
    assert.equal(shaped.thisWeek.metered, null);
    assert.equal(shaped.thisWeek.prices.old.excludesAiCredits, true);
    assert.equal(shaped.lastWeek.metered.aiCredits, 100);
    assert.equal(shaped.lastWeek.prices.old.amount, 1.5 + 1.5 + 1);
    assert.equal(shaped.total.meteredWeeks, 1);
    assert.equal(shaped.total.metered.aiCredits, 100);
    assert.equal(shaped.total.prices.old.amount, 3 + 1.5 + 1);
  });

  test('no imports reads exactly as before', () => {
    const shaped = shapeRowUsage(usage);
    assert.equal(shaped.total.meteredWeeks, 0);
    assert.equal(shaped.total.metered, null);
    assert.equal(addMetered([null, null]), null);
  });
});

describe('what the CSM copies', () => {
  const base = { runs: 22, flowRuns: 44, attempts: 50, runnerSeconds: 58.1 * 60, credits: 44 };
  const metered = { aiCredits: 120.4, interactiveMinutes: 40, suiteMinutes: 60 };
  const row = (week) => ({
    name: 'Acme',
    environmentName: 'Self-Serve',
    usage: { lastWeek: week },
  });

  test('old pricing names building minutes and AI credits when they were imported', () => {
    const week = shapeWeek(OCT_19, base, metered);
    assert.equal(
      describePrice(week, 'old'),
      '$15.92 (98.1 runner min at $0.15/min + 120.4 AI credits at $0.01)',
    );
    const message = usageMessage(row(week), 'old');
    assert.match(message, /58\.1 runner minutes running tests/);
    assert.match(message, /40 runner minutes building tests/);
    assert.match(message, /120\.4 AI credits/);
  });

  test('without an import it still says AI credits are not included', () => {
    const week = shapeWeek(OCT_19, base);
    assert.match(describePrice(week, 'old'), /AI credits not included/);
    assert.doesNotMatch(usageMessage(row(week), 'old'), /building tests/);
  });
});
