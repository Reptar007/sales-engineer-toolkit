/**
 * Lone Wolves page helpers (frontend/src/projects/lone-wolves/onboardingView.js),
 * loaded by relative path because the frontend has no test runner.
 *
 * The calendar and timeline are where a wrong date reads as a missed
 * milestone, so these pin the grid (Sunday first, whole weeks, today) and the
 * grouping of steps under the day they are due.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarCells,
  dayLabel,
  describeRuns,
  filterCounts,
  rowsToCsv,
  slackPulse,
  timeline,
  triggerCheck,
} from '../../frontend/src/projects/lone-wolves/onboardingView.js';

const NOW = Date.parse('2026-10-21T13:00:00.000Z');
const at = (day) => new Date(Date.UTC(2026, 9, day)).toISOString();

const kerv = {
  workspaceId: 'kerv1',
  name: 'Kerv',
  segment: 'custom',
  day: 8,
  pilotDays: 60,
  status: 'Stalled',
  reason: 'No active flows and no triggers.',
  activation: 'nnnnuu',
  milestones: {
    kickoffAt: at(13),
    steps: [
      { label: 'First flow', at: at(14), state: 'missed' },
      { label: 'Customer run', at: at(16), state: 'missed' },
      { label: 'Daily run', at: at(16), state: 'missed' },
      { label: 'First bug', at: at(20), state: 'missed' },
      { label: 'Failure owner', at: at(27), state: 'later' },
      { label: 'Client tests', at: at(27), state: 'later' },
    ],
    decision: {
      label: 'Pilot ends',
      at: new Date(Date.UTC(2026, 11, 12)).toISOString(),
      state: 'later',
    },
  },
};
const regal = {
  workspaceId: 'regal1',
  name: 'Regal',
  segment: 'hybrid',
  day: null,
  status: 'On track',
  milestones: null,
};

describe('calendar', () => {
  test('October 2026 starts on a Thursday in a Sunday-first grid of whole weeks', () => {
    const cells = calendarCells([kerv], 2026, 9, NOW);
    assert.equal(cells.length, 35);
    assert.equal(cells[4].day, 1);
    assert.equal(cells[0].inMonth, false);
    assert.equal(cells.find((c) => c.isToday).day, 21);
  });

  test('events land on their day, missed first, capped with a count', () => {
    const cells = calendarCells([kerv], 2026, 9, NOW, 1);
    const sixteenth = cells.find((c) => c.inMonth && c.day === 16);
    assert.equal(sixteenth.events.length, 1);
    assert.equal(sixteenth.more, 1);
    assert.equal(sixteenth.events[0].state, 'missed');
  });
});

describe('timeline', () => {
  test('steps group under the day they are due; no kickoff is listed apart', () => {
    const { scheduled, unscheduled } = timeline([kerv, regal]);
    assert.equal(scheduled.length, 1);
    assert.deepEqual(
      scheduled[0].columns.map((c) => c.map((chip) => chip.label)),
      [
        ['First flow'],
        ['Customer run', 'Daily run'],
        ['First bug'],
        ['Failure owner', 'Client tests'],
        ['Pilot ends'],
      ],
    );
    assert.equal(scheduled[0].columns[0][0].sub, '14 Oct · missed');
    assert.deepEqual(
      unscheduled.map((r) => r.name),
      ['Regal'],
    );
  });
});

describe('cells and exports', () => {
  test('labels', () => {
    assert.equal(dayLabel(kerv), 'Day 8 of 60');
    assert.equal(dayLabel(regal), '—');
    assert.equal(describeRuns({ total: 0, lastRunAt: at(9) }), 'none in 24h · last 9 Oct');
    assert.equal(describeRuns({ total: 3, pass: 2, fail: 1, running: 0 }), '2 pass · 1 fail');
    assert.deepEqual(triggerCheck({ count: 1, empty: 1 }), {
      text: '1 matches no flow',
      tone: 'bad',
    });
    assert.deepEqual(triggerCheck({ count: 0, empty: 0 }), { text: 'None set up', tone: 'bad' });
  });

  test('filter counts', () => {
    const counts = filterCounts([kerv, regal]);
    assert.equal(counts.all, 2);
    assert.equal(counts.attention, 1);
    assert.equal(counts.hybrid, 1);
  });

  test('CSV quotes commas and the pulse lists only rows needing a look', () => {
    const csv = rowsToCsv([{ ...kerv, nextStep: 'Ask Owen, then Sam' }]);
    assert.match(csv, /"Ask Owen, then Sam"/);
    const pulse = slackPulse(
      [kerv, regal],
      { total: 2, stalled: 1, dailyBad: 0, blocked: 0 },
      null,
    );
    assert.match(pulse, /\*Kerv\* \(Day 8 of 60\): Stalled/);
    assert.doesNotMatch(pulse, /Regal/);
  });
});
