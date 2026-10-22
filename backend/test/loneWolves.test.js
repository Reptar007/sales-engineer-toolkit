/**
 * Lone Wolves: the onboarding-health rules, the Task Wolf readings, the
 * details gate and the scan that joins them.
 *
 * The page's value is that a status or a red marker means what Becca thinks
 * it means, so these pin each rule to the case it was written for: Kerv's
 * empty workspace, Signant's trigger that selects nothing, SharkNinja's burst
 * of bugs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  activationSteps,
  buildRow,
  decisionFor,
  milestones,
  normalizeEnvironmentStatus,
  onboardingStatus,
  runOutcome,
  sortRows,
  summarize,
  summarizeBugs,
  summarizeEnvironments,
  summarizeRuns,
  summarizeTriggers,
} from '../src/projects/lone-wolves/onboardingShape.js';
import { hasCustomerRun, listTeamWorkspaces } from '../src/projects/lone-wolves/taskWolfSource.js';
import { normalizeDetails, OnboardingError } from '../src/projects/lone-wolves/workspaceStore.js';
import {
  resetOnboardingCache,
  rowsFor,
  scanOnboarding,
  workspacesToScan,
} from '../src/projects/lone-wolves/onboardingService.js';

const NOW = Date.parse('2026-10-21T13:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const ENV = 'envstaging01';
const flow = (id, readiness, tags = []) => ({ flowId: id, readiness, tags });
const schedule = (tagNames, extra = {}) => ({
  isPaused: false,
  configuration: { kind: 'schedule', environmentId: ENV, action: { tagNames, flowIds: [] } },
  ...extra,
});

describe('environments', () => {
  test('both spellings of needs investigation read the same', () => {
    assert.equal(normalizeEnvironmentStatus('needs-investigation'), 'needsInvestigation');
    assert.equal(normalizeEnvironmentStatus('needsInvestigation'), 'needsInvestigation');
    assert.equal(normalizeEnvironmentStatus('weird'), 'unknown');
  });

  test('one blocked static environment is the row status; previews do not count', () => {
    const summary = summarizeEnvironments([
      { kind: 'static', status: 'ready' },
      { kind: 'static', status: 'blocked' },
      { kind: 'preview', status: 'needs-investigation' },
    ]);
    assert.deepEqual(summary, { status: 'blocked', count: 2, blocked: 1 });
  });
});

describe('triggers', () => {
  const flows = { [ENV]: [flow('f1', 'active', ['CI']), flow('f2', 'draft', ['Nightly'])] };

  test('a trigger whose tag only a draft carries selects nothing (Signant)', () => {
    const t = summarizeTriggers([schedule(['Nightly'])], flows);
    assert.deepEqual(t, { count: 1, empty: 1, matchingSchedule: false });
  });

  test('a matching schedule counts; paused triggers are ignored', () => {
    const t = summarizeTriggers([schedule(['CI']), schedule(['Nope'], { isPaused: true })], flows);
    assert.deepEqual(t, { count: 1, empty: 0, matchingSchedule: true });
  });

  test('flow ids select too', () => {
    const byId = {
      isPaused: false,
      configuration: { kind: 'deployment', environmentId: ENV, action: { flowIds: ['f1'] } },
    };
    assert.equal(summarizeTriggers([byId], flows).empty, 0);
  });
});

describe('runs and bugs', () => {
  test('run statuses fold into pass, fail and running', () => {
    assert.equal(runOutcome('passed'), 'pass');
    assert.equal(runOutcome('fail'), 'fail');
    assert.equal(runOutcome('running'), 'running');
    assert.equal(runOutcome('superseded'), 'other');
  });

  test('only the last 24 hours are counted, but the newest run of all is kept', () => {
    const runs = summarizeRuns(
      [
        { createdAt: hoursAgo(1), status: 'pass' },
        { createdAt: hoursAgo(2), status: 'fail' },
        { createdAt: daysAgo(3), status: 'pass' },
      ],
      NOW,
    );
    assert.deepEqual(runs, { total: 2, pass: 1, fail: 1, running: 0, lastRunAt: NOW - 3600000 });
  });

  test('five bugs in a day is a spike; closed bugs still count as a first bug', () => {
    const fresh = Array.from({ length: 5 }, () => ({
      createdAt: hoursAgo(2),
      status: 'pending',
      priority: 'unprioritized',
    }));
    const bugs = summarizeBugs(fresh, NOW);
    assert.equal(bugs.spike, true);
    assert.equal(bugs.unprioritized, 5);
    const closed = summarizeBugs([{ createdAt: daysAgo(20), status: 'resolved' }], NOW);
    assert.deepEqual(closed, { open: 0, unprioritized: 0, newToday: 0, ever: true, spike: false });
  });
});

describe('activation and milestones', () => {
  const quiet = { count: 0, empty: 0, matchingSchedule: false };

  test('an empty workspace has only the recorded steps unknown (Kerv)', () => {
    const a = activationSteps({
      flows: { active: 0, draft: 0 },
      triggers: quiet,
      runs: { lastRunAt: null },
      bugs: { ever: false },
      now: NOW,
    });
    assert.equal(a, 'nunnuu');
  });

  test('a daily run needs a matching schedule and a run in two days', () => {
    const base = {
      flows: { active: 3 },
      bugs: { ever: true },
      details: { failureOwner: 'Vinod', clientBuildingTests: true },
      customerRun: true,
      now: NOW,
    };
    const on = { count: 1, empty: 0, matchingSchedule: true };
    assert.equal(
      activationSteps({ ...base, triggers: on, runs: { lastRunAt: NOW - 3600000 } }),
      'yyyyyy',
    );
    assert.equal(
      activationSteps({ ...base, triggers: on, runs: { lastRunAt: NOW - 3 * 86400000 } }),
      'yynyyy',
    );
  });

  test('target dates past without the step are missed; before them, coming up', () => {
    const m = milestones({
      kickoffOn: daysAgo(8),
      pilotDays: 60,
      segment: 'custom',
      activation: 'nnnnnu',
      now: NOW,
    });
    assert.deepEqual(
      m.steps.map((s) => s.state),
      ['missed', 'missed', 'missed', 'missed', 'later', 'later'],
    );
    assert.equal(m.decision.label, 'Pilot ends');
  });

  test('decision: pilot end, else day 30, and none for self-managed', () => {
    const kickoffOn = daysAgo(1);
    assert.equal(decisionFor({ kickoffOn, segment: 'self' }).label, 'Decision (day 30)');
    assert.equal(decisionFor({ kickoffOn, segment: 'hybrid' }), null);
    assert.equal(decisionFor({ kickoffOn: null }), null);
  });
});

describe('status', () => {
  const env = { status: 'ready', blocked: 0 };
  const okTriggers = { count: 1, empty: 0 };
  const okBugs = { spike: false };

  test('no active flows is stalled', () => {
    const s = onboardingStatus({
      flows: { active: 0 },
      runs: {},
      triggers: { count: 0 },
      bugs: okBugs,
      environment: env,
      now: NOW,
    });
    assert.deepEqual(s, { status: 'Stalled', reason: 'No active flows and no triggers.' });
  });

  test('a week without runs is stalled', () => {
    const s = onboardingStatus({
      flows: { active: 5 },
      runs: { lastRunAt: NOW - 9 * 86400000 },
      triggers: okTriggers,
      bugs: okBugs,
      environment: env,
      now: NOW,
    });
    assert.equal(s.status, 'Stalled');
  });

  test('a selector that matches nothing is watch', () => {
    const s = onboardingStatus({
      flows: { active: 5 },
      runs: { lastRunAt: NOW, pass: 3, fail: 0 },
      triggers: { count: 2, empty: 1 },
      bugs: okBugs,
      environment: env,
      now: NOW,
    });
    assert.deepEqual(s, { status: 'Watch', reason: '1 trigger(s) select no flow.' });
  });

  test('healthy is on track', () => {
    const s = onboardingStatus({
      flows: { active: 5 },
      runs: { lastRunAt: NOW, pass: 3, fail: 0 },
      triggers: okTriggers,
      bugs: okBugs,
      environment: env,
      now: NOW,
    });
    assert.equal(s.status, 'On track');
  });
});

describe('rows', () => {
  const platform = {
    environments: [{ id: ENV, kind: 'static', status: 'blocked' }],
    flowsByEnvironment: { [ENV]: [flow('f1', 'active', ['CI']), flow('f2', 'draft')] },
    triggers: [schedule(['CI'])],
    runs: [{ createdAt: hoursAgo(3), status: 'pass' }],
    bugs: [{ createdAt: daysAgo(2), status: 'pending', priority: 'high' }],
  };

  test('a scanned workspace becomes a full row', () => {
    const row = buildRow({
      workspace: { id: 'ws1', name: 'Shark', source: 'team' },
      details: { kickoffOn: daysAgo(9), pilotDays: 30, segment: 'self' },
      platform,
      customerRun: true,
      now: NOW,
    });
    assert.equal(row.day, 9);
    assert.deepEqual(row.flows, { active: 1, draft: 1 });
    assert.equal(row.activation, 'yyyyuu');
    assert.equal(row.status, 'Watch');
    assert.equal(row.milestones.decision.label, 'Pilot ends');
    assert.equal(row.usage, null);
  });

  test('a workspace QA Wolf could not read says so instead of guessing', () => {
    const row = buildRow({
      workspace: { id: 'ws2', name: 'X', source: 'manual' },
      platform: { error: 'boom' },
      now: NOW,
    });
    assert.equal(row.status, 'Unread');
    assert.equal(row.reason, 'boom');
  });

  test('stalled sorts first and the tiles count from the rows', () => {
    const rows = sortRows([
      {
        name: 'B',
        status: 'On track',
        segment: 'self',
        environment: { status: 'ready' },
        runs: { pass: 1, fail: 0 },
      },
      {
        name: 'A',
        status: 'Stalled',
        segment: 'custom',
        environment: { status: 'blocked' },
        runs: { pass: 0, fail: 2 },
      },
    ]);
    assert.deepEqual(
      rows.map((r) => r.name),
      ['A', 'B'],
    );
    const s = summarize(rows);
    assert.equal(s.stalled, 1);
    assert.equal(s.blocked, 1);
    assert.deepEqual(s.dailyBadNames, ['A']);
    assert.equal(s.bySegment.custom, 1);
  });
});

describe('Task Wolf readings', () => {
  test('the team list keeps only safe ids', async () => {
    const client = {
      callTool: async (tool, args) => {
        assert.equal(tool, 'query_task_wolf_db');
        assert.match(args.sql, /t.name = 'SelfService'/);
        return {
          rows: [
            { qawId: 'abc123', officialName: 'Kerv', slug: 'kerv' },
            { qawId: "x'; drop", officialName: 'Bad' },
          ],
        };
      },
    };
    assert.deepEqual(await listTeamWorkspaces(client), [
      { id: 'abc123', name: 'Kerv', slug: 'kerv' },
    ]);
  });

  test('a run by hand from someone at the customer counts; triggered or unknown ones do not', () => {
    const people = new Set(['vinod prasaddevkota']);
    const suites = (list) => ({ recentSuites: { suites: list } });
    assert.equal(
      hasCustomerRun(suites([{ creatorName: 'Vinod  Prasaddevkota', triggerName: null }]), people),
      true,
    );
    assert.equal(
      hasCustomerRun(
        suites([{ creatorName: 'Vinod Prasaddevkota', triggerName: 'Daily' }]),
        people,
      ),
      null,
    );
    assert.equal(
      hasCustomerRun(suites([{ creatorName: 'Becca', triggerName: null }]), people),
      null,
    );
  });
});

describe('details', () => {
  test('dates, lengths and tickets are checked and converted', () => {
    const d = normalizeDetails({
      kickoffOn: '2026-10-13',
      pilotDays: '60',
      linearIssue: 'axo-1278',
      segment: 'custom',
    });
    assert.equal(d.kickoffOn.toISOString(), '2026-10-13T00:00:00.000Z');
    assert.equal(d.pilotDays, 60);
    assert.equal(d.linearIssue, 'AXO-1278');
  });

  test('only sent fields are touched, and empty clears', () => {
    assert.deepEqual(normalizeDetails({ ae: '' }), { ae: null });
  });

  test('bad input is refused', () => {
    assert.throws(() => normalizeDetails({ segment: 'enterprise' }), OnboardingError);
    assert.throws(() => normalizeDetails({ kickoffOn: '13/10/2026' }), OnboardingError);
    assert.throws(() => normalizeDetails({ pilotDays: 0 }), OnboardingError);
    assert.throws(() => normalizeDetails({ linearIssue: 'not a ticket' }), OnboardingError);
  });
});

describe('scan', () => {
  test('team workspaces plus manual ones, hidden ones out', () => {
    const list = workspacesToScan(
      [
        { id: 'team1', name: 'Kerv' },
        { id: 'team2', name: 'Gone' },
      ],
      [
        { workspaceId: 'team2', hidden: true },
        { workspaceId: 'man1', addedManually: true, workspaceName: 'Panorama' },
      ],
    );
    assert.deepEqual(
      list.map((ws) => [ws.id, ws.source]),
      [
        ['team1', 'team'],
        ['man1', 'manual'],
      ],
    );
  });

  test('one unreadable workspace does not sink the scan; an auth failure does', async () => {
    resetOnboardingCache();
    const client = {
      callTool: async (tool) =>
        tool === 'query_task_wolf_db'
          ? {
              rows: [
                { qawId: 'aaa111', officialName: 'A' },
                { qawId: 'bbb222', officialName: 'B' },
              ],
            }
          : { recentSuites: { suites: [] } },
    };
    const scan = await scanOnboarding({
      taskWolfClient: client,
      listDetailsImpl: async () => [],
      readWorkspaceImpl: async (id) => {
        if (id === 'bbb222') throw Object.assign(new Error('nope'), { code: 'QAW_UPSTREAM' });
        return { environments: [], flowsByEnvironment: {}, triggers: [], runs: [], bugs: [] };
      },
      now: NOW,
    });
    const rows = rowsFor(scan, [], NOW);
    assert.deepEqual(
      rows.map((r) => [r.name, r.status]),
      [
        ['A', 'Stalled'],
        ['B', 'Unread'],
      ],
    );

    await assert.rejects(
      scanOnboarding({
        taskWolfClient: client,
        listDetailsImpl: async () => [],
        readWorkspaceImpl: async () => {
          throw Object.assign(new Error('expired'), { code: 'QAW_AUTH' });
        },
        now: NOW,
      }),
      /expired/,
    );
  });

  test('without Task Wolf only manual workspaces are scanned, and the page is told', async () => {
    const scan = await scanOnboarding({
      taskWolfClient: null,
      listDetailsImpl: async () => [
        { workspaceId: 'man1', addedManually: true, workspaceName: 'P' },
      ],
      readWorkspaceImpl: async () => ({
        environments: [],
        flowsByEnvironment: {},
        triggers: [],
        runs: [],
        bugs: [],
      }),
      now: NOW,
    });
    assert.equal(scan.workspaces.length, 1);
    assert.match(scan.warnings[0], /not configured/);
  });

  test('details saved after the scan show without a rescan', () => {
    const scan = {
      workspaces: [
        {
          workspace: { id: 'w1', name: 'Kerv', source: 'team' },
          platform: { error: 'x' },
          customerRun: null,
        },
      ],
    };
    const rows = rowsFor(
      scan,
      [{ workspaceId: 'w1', kickoffOn: daysAgo(8), linearIssue: 'AXO-1278' }],
      NOW,
    );
    assert.equal(rows[0].day, 8);
    assert.equal(rows[0].linearIssue, 'AXO-1278');
    assert.deepEqual(rowsFor(scan, [{ workspaceId: 'w1', hidden: true }], NOW), []);
  });
});
