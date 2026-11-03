/**
 * Lone Wolves "Pull from Metronome": the server's version of the Metronome
 * usage script. Its paging, its environment rule (suite time by
 * environment, AI credits and interactive time by chat session), and the
 * background pull that keeps the token only while it runs.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKEN_REJECTED,
  cleanToken,
  pullEvents,
} from '../src/projects/lone-wolves/metronomeClient.js';
import { inEnvironment, weeksFromEvents } from '../src/projects/lone-wolves/meteredImport.js';
import {
  metronomeConnectionLine,
  pullFailure,
  pullProgress,
  pullSummary,
} from '../../frontend/src/projects/lone-wolves/onboardingView.js';
import {
  DEFAULT_LIFETIME_MS,
  NOT_CONNECTED,
  connectMetronome,
  connectionStatus,
  disconnectMetronome,
  metronomeToken,
  resetConnection,
  tokenExpiry,
} from '../src/projects/lone-wolves/metronomeConnection.js';
import {
  SESSIONS_FAILED,
  fillWeeks,
  pullEvery,
  pullStatus,
  pullWeeks,
  resetPulls,
  startPull,
} from '../src/projects/lone-wolves/metronomePull.js';
import { chatSessionIds } from '../src/projects/lone-wolves/taskWolfSource.js';
import {
  OnboardingError,
  metronomeAliases,
  normalizeDetails,
} from '../src/projects/lone-wolves/workspaceStore.js';

const ENV = 'sh8oia54ja68rsjzwqjvm1duoenv';
const OCT_19 = Date.parse('2026-10-19T00:00:00Z');
const OCT_26 = Date.parse('2026-10-26T00:00:00Z');

const event = (id, type, timestamp, properties, extra = {}) => ({
  transaction_id: id,
  event_type: type,
  timestamp,
  properties,
  is_duplicate: false,
  ...extra,
});

describe('which events are the environment’s', () => {
  const sessions = new Set(['s1']);

  test('suite time by its environment; AI and interactive time by chat session', () => {
    assert.equal(inEnvironment({ environmentId: ENV }, ENV, sessions), true);
    assert.equal(inEnvironment({ environmentId: 'otherenv' }, ENV, sessions), false);
    assert.equal(inEnvironment({ testerSessionId: 's1' }, ENV, sessions), true);
    assert.equal(inEnvironment({ sessionId: 's1' }, ENV, sessions), true);
    assert.equal(inEnvironment({ testerSessionId: 's9' }, ENV, sessions), false);
    // AI work with no session (some run investigations) cannot be placed.
    assert.equal(inEnvironment({}, ENV, sessions), false);
  });

  test('summed per Monday week into AI credits, interactive and suite minutes', () => {
    const events = [
      event('a', 'ai_credits', '2026-10-20T10:00:00Z', {
        ai_credits: '120.5',
        testerSessionId: 's1',
      }),
      event('b', 'runner_seconds', '2026-10-21T10:00:00Z', {
        seconds: 600,
        mode: 'interactive',
        testerSessionId: 's1',
      }),
      event('c', 'runner_seconds', '2026-10-25T23:59:00Z', { seconds: 90, environmentId: ENV }),
      event('d', 'runner_seconds', '2026-10-26T00:01:00Z', { seconds: 60, environmentId: ENV }),
      event('e', 'ai_credits', '2026-10-20T10:00:00Z', { ai_credits: 999, testerSessionId: 's9' }),
      event('f', 'seats', '2026-10-20T10:00:00Z', { environmentId: ENV, count: 3 }),
    ];
    assert.deepEqual(weeksFromEvents(events, ENV, sessions), [
      { weekStart: OCT_19, aiCredits: 120.5, interactiveMinutes: 10, suiteMinutes: 1.5 },
      { weekStart: OCT_26, aiCredits: 0, interactiveMinutes: 0, suiteMinutes: 1 },
    ]);
  });
});

describe('reading Metronome', () => {
  const page = (from, count, at = '2026-10-20T00:00:00.000Z') =>
    Array.from({ length: count }, (_, i) =>
      event(`t${from + i}`, 'ai_credits', at, { ai_credits: 1 }),
    );
  const answer = (data, status = 200) => ({
    ok: status === 200,
    status,
    json: async () => data,
  });
  const noSleep = async () => {};

  test('pages back from the newest, drops repeats and duplicates', async () => {
    const calls = [];
    const pages = [
      page(0, 1000, '2026-10-25T00:00:00.000Z'),
      [...page(999, 3, '2026-10-21T00:00:00.000Z'), { ...page(5000, 1)[0], is_duplicate: true }],
    ];
    const fetchImpl = async (url, init) => {
      calls.push(JSON.parse(init.body).variables);
      assert.equal(init.headers.authorization, 'Bearer tok');
      assert.equal(init.headers['x-metronome-readonly'], 'true');
      return answer({ data: { mri_events: pages[calls.length - 1] } });
    };
    const events = await pullEvents({
      token: 'tok',
      aliases: ['a1'],
      start: '2026-10-19T00:00:00Z',
      end: '2026-11-02T00:00:00Z',
      fetchImpl,
      sleep: noSleep,
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].ending_before, '2026-10-25T00:00:00.001Z');
    assert.deepEqual(calls[0].ingest_aliases, ['a1']);
    assert.equal(events.length, 1002);
  });

  test('a turned-down token stops at once and says to get a fresh one', async () => {
    for (const reply of [
      answer({}, 401),
      answer({ errors: [{ message: 'Could not verify JWT: JWTExpired' }] }),
    ]) {
      await assert.rejects(
        pullEvents({
          token: 't',
          aliases: ['a'],
          start: 's',
          end: 'e',
          fetchImpl: async () => reply,
          sleep: noSleep,
        }),
        (error) => error.code === TOKEN_REJECTED && /fresh one/.test(error.message),
      );
    }
  });

  test('Metronome’s passing errors are retried', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return n < 3
        ? answer({ errors: [{ message: 'DOWNSTREAM_SERVICE_ERROR' }] })
        : answer({ data: { mri_events: page(0, 2) } });
    };
    const events = await pullEvents({
      token: 't',
      aliases: ['a'],
      start: 's',
      end: 'e',
      fetchImpl,
      sleep: noSleep,
    });
    assert.equal(n, 3);
    assert.equal(events.length, 2);
  });

  test('a pasted token loses its "Bearer " and spaces', () => {
    assert.equal(cleanToken('  Bearer abc.def \n'), 'abc.def');
    assert.equal(cleanToken(undefined), '');
  });
});

describe('the customer’s Metronome ids', () => {
  test('commas or spaces, kept comma-separated; null clears', () => {
    assert.equal(
      metronomeAliases('org_01KHP3G3FD, r6ucmdjarboy3zsigfmdaaz0oorg  d2842330-0a58-400a'),
      'org_01KHP3G3FD,r6ucmdjarboy3zsigfmdaaz0oorg,d2842330-0a58-400a',
    );
    assert.equal(metronomeAliases(''), null);
    assert.deepEqual(normalizeDetails({ metronomeAliases: null }), { metronomeAliases: null });
  });

  test('nothing that could be anything but an id', () => {
    assert.throws(() => metronomeAliases('org_1"; drop'), OnboardingError);
    assert.throws(() => metronomeAliases('a1234,b1234,c1234,d1234,e1234,f1234'), OnboardingError);
  });
});

describe('chat sessions from Task Wolf', () => {
  test('asks the platform database for the environment’s sessions', async () => {
    let asked;
    const client = {
      callTool: async (tool, args) => {
        asked = { tool, ...args };
        return { rows: [{ id: 's1' }, { id: 's2' }] };
      },
    };
    assert.deepEqual([...(await chatSessionIds(client, ENV))], ['s1', 's2']);
    assert.equal(asked.tool, 'query_platform_db');
    assert.match(asked.sql, /"environmentId" = 'sh8oia54ja68rsjzwqjvm1duoenv'/);
    assert.equal((await chatSessionIds(client, "x' or 1=1")).size, 0);
  });
});

describe('a pull', () => {
  beforeEach(() => resetPulls());
  const NOW = Date.parse('2026-11-02T15:00:00Z');
  const base = {
    workspaceId: 'w1',
    environmentId: ENV,
    aliases: 'a1,a2',
    kickoffOn: '2026-10-13T00:00:00.000Z',
    token: 'secret-token',
    viewer: { email: 'becca@qawolf.com' },
    now: NOW,
    taskWolfClient: {},
  };

  test('covers kickoff week to this week, zero where nothing ran', () => {
    const weeks = pullWeeks(base.kickoffOn, NOW);
    assert.deepEqual(
      weeks.map((w) => new Date(w).toISOString().slice(0, 10)),
      ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'],
    );
    assert.equal(pullWeeks(null, NOW).length, 6);
    assert.deepEqual(fillWeeks([OCT_19], []), [
      { weekStart: OCT_19, aiCredits: 0, interactiveMinutes: 0, suiteMinutes: 0 },
    ]);
  });

  test('reads sessions and events, saves every week, and never shows the token', async () => {
    let saved;
    let askedEvents;
    const { status, done } = startPull({
      ...base,
      sessionIdsImpl: async () => new Set(['s1']),
      pullEventsImpl: async (args) => {
        askedEvents = args;
        return [
          event('a', 'ai_credits', '2026-10-20T10:00:00Z', {
            ai_credits: 50,
            testerSessionId: 's1',
          }),
        ];
      },
      saveImpl: async (...args) => {
        saved = args;
      },
    });
    assert.equal(status.state, 'running');
    await done;
    assert.deepEqual(askedEvents.aliases, ['a1', 'a2']);
    assert.equal(askedEvents.token, 'secret-token');
    assert.equal(askedEvents.start, '2026-10-12T00:00:00.000Z');
    assert.equal(saved[0], 'w1');
    assert.equal(saved[2].length, 4);
    assert.equal(saved[2][1].aiCredits, 50);
    const after = pullStatus('w1');
    assert.equal(after.state, 'done');
    assert.equal(after.weeks.length, 4);
    assert.doesNotMatch(JSON.stringify(after), /secret-token/);
  });

  test('a failure is kept with why; one pull at a time', async () => {
    const hang = new Promise(() => {});
    startPull({ ...base, sessionIdsImpl: () => hang });
    assert.throws(
      () => startPull(base),
      (e) => e.code === 'ONBOARDING_BUSY',
    );
    resetPulls();
    const { done } = startPull({
      ...base,
      sessionIdsImpl: async () => new Set(),
      pullEventsImpl: async () => {
        throw new OnboardingError(TOKEN_REJECTED, 'Metronome turned the token down.');
      },
    });
    await done;
    assert.equal(pullStatus('w1').state, 'failed');
    assert.match(pullStatus('w1').error, /turned the token down/);
    assert.equal(pullStatus('w1').errorCode, TOKEN_REJECTED);
  });

  test('says which of three steps it is on, and names a Task Wolf failure as such', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { status, done } = startPull({
      ...base,
      sessionIdsImpl: async () => {
        await gate;
        throw new Error('403 forbidden');
      },
    });
    assert.equal(status.stepNumber, 1);
    assert.equal(status.stepCount, 3);
    assert.match(status.step, /sessions/);
    release();
    await done;
    const after = pullStatus('w1');
    assert.equal(after.errorCode, SESSIONS_FAILED);
    assert.match(after.error, /403 forbidden/);
    assert.equal(after.stepNumber, null);
  });

  test('progress names the step, of how many, and the records read', () => {
    const running = {
      state: 'running',
      step: 'Reading usage from Metronome',
      stepNumber: 2,
      stepCount: 3,
      events: 12000,
    };
    assert.equal(
      pullProgress(running),
      'Step 2 of 3: Reading usage from Metronome (12,000 records so far)',
    );
    assert.equal(pullProgress({ state: 'done' }), null);
  });

  test('a finished pull adds up what it got', () => {
    const weeks = [
      { aiCredits: 1176, interactiveMinutes: 296, suiteMinutes: 58 },
      { aiCredits: 984, interactiveMinutes: 640, suiteMinutes: 174 },
    ];
    assert.equal(
      pullSummary({ state: 'done', weeks }),
      'Got 2 weeks: 2,160 AI credits, 936 minutes building tests and 232 minutes running them.',
    );
  });

  test('a failure says what happened and what to do, in plain words', () => {
    for (const errorCode of [TOKEN_REJECTED, NOT_CONNECTED]) {
      assert.match(pullFailure({ state: 'failed', errorCode }).next, /admin to reconnect/);
    }
    assert.doesNotMatch(
      pullFailure({ state: 'failed', errorCode: 'METRONOME_FAILED' }).next,
      /code/,
    );
    assert.match(pullFailure({ state: 'failed', errorCode: SESSIONS_FAILED }).next, /CSV/);
    assert.equal(
      pullFailure({ state: 'failed', errorCode: null, error: 'Something odd.' }).next,
      'Something odd.',
    );
    assert.equal(pullFailure({ state: 'running' }), null);
  });

  test('refused without ids, a token or Task Wolf', () => {
    assert.throws(() => startPull({ ...base, aliases: null }), /Metronome ids/);
    assert.throws(() => startPull({ ...base, token: '' }), /token/);
    assert.throws(() => startPull({ ...base, taskWolfClient: null }), /Task Wolf/);
    assert.equal(pullStatus('w1').state, 'idle');
  });

  test('a code Metronome turns down is dropped; any other failure keeps it', async () => {
    const forgot = [];
    const failWith = (code) =>
      startPull({
        ...base,
        sessionIdsImpl: async () => new Set(),
        pullEventsImpl: async () => {
          throw new OnboardingError(code, 'no');
        },
        forgetImpl: (token) => forgot.push(token),
      }).done;
    await failWith('METRONOME_FAILED');
    assert.deepEqual(forgot, []);
    await failWith(TOKEN_REJECTED);
    assert.deepEqual(forgot, ['secret-token']);
  });

  test('every card, one at a time, stopping when the code is turned down', async () => {
    const order = [];
    const targets = ['w1', 'w2', 'w3', 'w4'].map((workspaceId) => ({
      workspaceId,
      environmentId: ENV,
      aliases: 'a1',
      kickoffOn: base.kickoffOn,
    }));
    let running = 0;
    const finished = await pullEvery(targets, {
      token: 'secret-token',
      viewer: base.viewer,
      now: NOW,
      taskWolfClient: {},
      sessionIdsImpl: async () => new Set(),
      pullEventsImpl: async ({ aliases }) => {
        running += 1;
        assert.equal(running, 1);
        order.push(aliases);
        await Promise.resolve();
        running -= 1;
        if (order.length === 3) throw new OnboardingError(TOKEN_REJECTED, 'expired');
        return [];
      },
      saveImpl: async () => {},
      forgetImpl: () => {},
    });
    assert.equal(finished, 2);
    assert.equal(order.length, 3);
    assert.equal(pullStatus('w4').state, 'idle');
  });
});

describe('the server’s Metronome connection', () => {
  beforeEach(() => resetConnection());
  const NOW = Date.parse('2026-11-03T15:00:00Z');
  const jwt = (exp) =>
    ['x', Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'sig'].join('.');

  test('runs out when the code says, else in a day', () => {
    assert.equal(tokenExpiry(jwt(NOW / 1000 + 3600), NOW), NOW + 3600 * 1000);
    assert.equal(tokenExpiry('not-a-jwt', NOW), NOW + DEFAULT_LIFETIME_MS);
  });

  test('connects, hands the code to pulls only, and forgets it when it runs out', () => {
    assert.throws(
      () => metronomeToken(NOW),
      (e) => e.code === NOT_CONNECTED,
    );
    const token = jwt(NOW / 1000 + 2 * 3600);
    const status = connectMetronome(`Bearer ${token}`, { email: 'sebastian@qawolf.com' }, NOW);
    assert.equal(status.connected, true);
    assert.equal(status.by, 'sebastian@qawolf.com');
    assert.doesNotMatch(JSON.stringify(connectionStatus(NOW)), new RegExp(token.slice(0, 10)));
    assert.equal(metronomeToken(NOW), token);
    assert.equal(
      metronomeConnectionLine(connectionStatus(NOW), NOW),
      'Connected to Metronome by sebastian@qawolf.com · runs out in about 2 hours',
    );
    assert.equal(connectionStatus(NOW + 2 * 3600 * 1000).connected, false);
    assert.match(metronomeConnectionLine({ connected: false }), /Not connected/);
  });

  test('refuses an empty or spent code; dropping a stale code keeps a newer one', () => {
    assert.throws(() => connectMetronome('  ', null, NOW), /Paste/);
    assert.throws(
      () => connectMetronome(jwt(NOW / 1000 - 1), null, NOW),
      (e) => e.code === TOKEN_REJECTED,
    );
    connectMetronome('newer', null, NOW);
    disconnectMetronome('older');
    assert.equal(metronomeToken(NOW), 'newer');
    disconnectMetronome();
    assert.equal(connectionStatus(NOW).connected, false);
  });
});
