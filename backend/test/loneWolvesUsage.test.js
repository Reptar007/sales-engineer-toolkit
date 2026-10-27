/**
 * Lone Wolves weekly usage: the counting rule (Becca's Usage section and the
 * Runs-Based Pricing page), the caches that keep a scan from re-reading every
 * run, pricing on the recorded model only, and the message the CSM posts.
 *
 * The checks come from real cases: Panorama's 10/25 run whose retries ended
 * after the run said it completed, the pricing page's 3/12/6-minute example,
 * and Windows and Mac costing 2 credits like mobile.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  creditMultiplier,
  flowRunCredits,
  priceUsage,
  runUsage,
  runnerMinutes,
  sumUsage,
  weekStartOf,
} from '../src/projects/lone-wolves/usageShape.js';
import {
  countWeek,
  resetUsageCache,
  weeklyUsage,
} from '../src/projects/lone-wolves/usageService.js';
import { shapeRowUsage } from '../src/projects/lone-wolves/onboardingService.js';
import { normalizeDetails, OnboardingError } from '../src/projects/lone-wolves/workspaceStore.js';
import { buildRow } from '../src/projects/lone-wolves/onboardingShape.js';
import {
  describePrice,
  describeUsage,
  usageMessage,
  weekRange,
} from '../../frontend/src/projects/lone-wolves/onboardingView.js';

const MIN = 60 * 1000;
const attempt = (startIso, minutes, extra = {}) => ({
  startedAt: startIso,
  completedAt: new Date(Date.parse(startIso) + minutes * MIN).toISOString(),
  kind: 'automated',
  ...extra,
});

describe('weeks', () => {
  test('weeks start Monday 00:00 UTC', () => {
    const monday = Date.UTC(2026, 9, 19);
    assert.equal(weekStartOf(Date.UTC(2026, 9, 25, 23, 59)), monday);
    assert.equal(weekStartOf(Date.UTC(2026, 9, 19, 0, 0)), monday);
    assert.equal(weekStartOf('2026-10-26T00:00:00Z'), monday + 7 * 24 * 60 * MIN);
  });
});

describe('credits', () => {
  test('the pricing page example: 3, 12 and 6 minutes is 3 credits', () => {
    const t = '2026-10-20T10:00:00Z';
    assert.equal(flowRunCredits([attempt(t, 3), attempt(t, 12), attempt(t, 6)]), 3);
  });

  test('a short run is 1 credit; exactly 5 minutes is still 1', () => {
    assert.equal(flowRunCredits([attempt('2026-10-20T10:00:00Z', 0.5)]), 1);
    assert.equal(flowRunCredits([attempt('2026-10-20T10:00:00Z', 5)]), 1);
    assert.equal(flowRunCredits([]), 1);
  });

  test('iOS, Android, Windows and Mac cost 2 per block; web and Linux 1', () => {
    assert.equal(creditMultiplier('Web - Chrome'), 1);
    assert.equal(creditMultiplier('Linux Electron'), 1);
    assert.equal(creditMultiplier(undefined), 1);
    for (const target of ['iOS - iPhone 15', 'Android - Pixel 8', 'Windows', 'macOS']) {
      assert.equal(creditMultiplier(target), 2, target);
    }
    assert.equal(flowRunCredits([attempt('2026-10-20T10:00:00Z', 7)], 2), 4);
  });
});

describe('a run', () => {
  test("minutes come from attempts, not the run's completedAt (Panorama 10/25)", () => {
    // The run said complete at 09:00:52; its retries ran to 09:02:26.
    const run = {
      completedAt: '2026-10-25T09:00:52.783Z',
      flows: [
        {
          flowId: 'signin',
          attempts: [
            { startedAt: '2026-10-25T09:00:07.395Z', completedAt: '2026-10-25T09:00:52.581Z' },
            { startedAt: '2026-10-25T09:00:57.189Z', completedAt: '2026-10-25T09:01:39.351Z' },
            { startedAt: '2026-10-25T09:01:44.107Z', completedAt: '2026-10-25T09:02:26.280Z' },
          ],
        },
      ],
    };
    const u = runUsage(run, { signin: 'Web - Chrome' });
    assert.equal(u.flowRuns, 1);
    assert.equal(u.attempts, 3);
    assert.equal(u.credits, 1);
    // 45.2 + 42.2 + 42.2 seconds, retries included.
    assert.equal(Math.round(u.runnerSeconds), 130);
  });

  test('manual attempts count; unfinished ones are flagged, not timed', () => {
    const run = {
      flows: [
        {
          flowId: 'a',
          attempts: [
            attempt('2026-10-21T10:00:00Z', 1),
            attempt('2026-10-21T13:52:00Z', 3.35, { kind: 'manual' }),
          ],
        },
        { flowId: 'b', attempts: [{ startedAt: '2026-10-21T10:00:00Z' }] },
      ],
    };
    const u = runUsage(run, {});
    assert.equal(u.flowRuns, 2);
    assert.equal(u.unfinished, 1);
    assert.equal(Math.round(u.runnerSeconds), Math.round(4.35 * 60));
    assert.equal(u.credits, 2);
  });

  test('a week sums its runs and rounds minutes to one decimal', () => {
    const week = sumUsage([
      { flowRuns: 2, attempts: 3, runnerSeconds: 1000, credits: 2, unfinished: 0 },
      { flowRuns: 1, attempts: 1, runnerSeconds: 2485.4, credits: 1, unfinished: 0 },
    ]);
    assert.deepEqual(week, {
      runs: 2,
      flowRuns: 3,
      attempts: 4,
      runnerSeconds: 3485.4,
      credits: 3,
      unfinished: 0,
    });
    assert.equal(runnerMinutes(week), 58.1);
  });
});

describe('pricing', () => {
  const week = { credits: 44, runnerSeconds: 58.09 * 60 };

  test('every week is priced both ways: new at $1 a credit, old at $0.15 a minute', () => {
    assert.deepEqual(priceUsage(week), {
      new: { rate: 1, amount: 44 },
      old: { rate: 0.15, amount: 8.71, excludesAiCredits: true },
    });
    assert.equal(priceUsage(null), null);
  });

  test('only the pick is stored per workspace, never a rate', () => {
    assert.deepEqual(normalizeDetails({ priceModel: 'minutes', creditRate: 1 }), {});
    assert.deepEqual(normalizeDetails({ pricing: 'new' }), { pricing: 'new' });
    assert.deepEqual(normalizeDetails({ pricing: null }), { pricing: null });
    assert.throws(() => normalizeDetails({ pricing: 'discounted' }), OnboardingError);
  });

  test('a row reads its pick, and an unpicked one reads as old', () => {
    const row = (details) =>
      buildRow({ workspace: { id: 'w', name: 'W' }, details, platform: { error: 'x' } });
    assert.equal(row({ pricing: 'new' }).pricing, 'new');
    assert.equal(row({ pricing: 'none' }).pricing, 'none');
    assert.equal(row({}).pricing, 'old');
  });
});

describe('reading runs', () => {
  beforeEach(() => resetUsageCache());
  const NOW = Date.parse('2026-10-27T12:00:00Z');
  const run = (id, createdAt) => ({ runId: id, createdAt });
  const detail = { flows: [{ flowId: 'f', attempts: [attempt('2026-10-26T10:00:00Z', 2)] }] };

  test('settled runs are read once; recent ones every time', async () => {
    const calls = [];
    const args = {
      workspaceId: 'w',
      environmentId: 'e',
      weekStart: Date.UTC(2026, 9, 26),
      targets: {},
      now: NOW,
      listRunsImpl: async () => [
        run('old', '2026-10-26T10:00:00Z'),
        run('new', '2026-10-27T11:00:00Z'),
      ],
      getRunImpl: async (id) => {
        calls.push(id);
        return detail;
      },
    };
    const first = await countWeek(args);
    await countWeek(args);
    assert.equal(first.runs, 2);
    assert.equal(first.credits, 2);
    assert.deepEqual(calls, ['old', 'new', 'new']);
  });

  test('last week is stored once counted, and only when every attempt finished', async () => {
    const saved = [];
    const base = {
      workspaceId: 'w',
      environmentId: 'e',
      targets: {},
      now: NOW,
      getStoredImpl: async () => null,
      saveStoredImpl: async (...a) => saved.push(a),
    };
    const done = {
      runs: 1,
      flowRuns: 1,
      attempts: 1,
      runnerSeconds: 60,
      credits: 1,
      unfinished: 0,
    };
    const result = await weeklyUsage({ ...base, countWeekImpl: async () => done });
    assert.equal(saved.length, 1);
    assert.equal(saved[0][2], Date.UTC(2026, 9, 19));
    assert.equal(result.thisWeekStart, Date.UTC(2026, 9, 26));

    saved.length = 0;
    await weeklyUsage({ ...base, countWeekImpl: async () => ({ ...done, unfinished: 1 }) });
    assert.equal(saved.length, 0);
  });

  test('a stored week is not recounted', async () => {
    const counted = [];
    await weeklyUsage({
      workspaceId: 'w',
      environmentId: 'e',
      targets: {},
      now: NOW,
      getStoredImpl: async () => ({
        runs: 22,
        flowRuns: 44,
        attempts: 66,
        runnerSeconds: 3485,
        credits: 44,
      }),
      saveStoredImpl: async () => assert.fail('should not save'),
      countWeekImpl: async ({ weekStart }) => {
        counted.push(weekStart);
        return { runs: 0, flowRuns: 0, attempts: 0, runnerSeconds: 0, credits: 0, unfinished: 0 };
      },
    });
    assert.deepEqual(counted, [Date.UTC(2026, 9, 26)]);
  });
});

describe('the page', () => {
  const lastWeek = { runs: 22, flowRuns: 44, attempts: 66, runnerSeconds: 58.09 * 60, credits: 44 };
  const usage = {
    thisWeekStart: Date.UTC(2026, 9, 26),
    thisWeek: { runs: 3, flowRuns: 3, attempts: 3, runnerSeconds: 120, credits: 3, unfinished: 0 },
    lastWeekStart: Date.UTC(2026, 9, 19),
    lastWeek,
  };

  const row = {
    name: 'Panorama Education',
    environmentName: 'Self-Serve',
    usage: shapeRowUsage(usage),
  };

  test('both weeks carry both prices', () => {
    assert.equal(row.usage.lastWeek.runnerMinutes, 58.1);
    assert.equal(row.usage.lastWeek.prices.old.amount, 8.71);
    assert.equal(row.usage.lastWeek.prices.new.amount, 44);
    assert.equal(row.usage.thisWeek.prices.new.amount, 3);
    assert.deepEqual(shapeRowUsage({ error: 'boom' }), { error: 'boom' });
  });

  test('price lines', () => {
    const week = row.usage.lastWeek;
    assert.equal(weekRange(week.weekStart), 'Mon 19 Oct – Sun 25 Oct');
    assert.equal(describeUsage(week), '22 runs · 44 test runs · 58.1 runner min · 44 credits');
    assert.equal(
      describePrice(week, 'old'),
      '$8.71 (58.1 runner min at $0.15/min; AI credits not included)',
    );
    assert.equal(describePrice(week, 'new'), '$44.00 (44 run credits at $1.00)');
    assert.equal(describePrice(week, 'none'), null);
  });

  test('the CSM message follows the pricing picked', () => {
    const old = usageMessage(row, 'old');
    assert.match(old, /Panorama Education team/);
    assert.match(old, /Mon 19 Oct – Sun 25 Oct in your Self-Serve environment/);
    assert.match(old, /58\.1 runner minutes/);
    assert.match(old, /\$8\.71/);
    assert.doesNotMatch(old, /run credit/);

    const fresh = usageMessage(row, 'new');
    assert.match(fresh, /44 run credits/);
    assert.match(fresh, /\$44\.00/);
    assert.doesNotMatch(fresh, /runner minutes/);

    const counts = usageMessage(row, 'none');
    assert.match(counts, /58\.1 runner minutes/);
    assert.match(counts, /44 run credits/);
    assert.doesNotMatch(counts, /\$/);

    assert.equal(usageMessage({ name: 'X', usage: null }, 'old'), null);
  });
});
