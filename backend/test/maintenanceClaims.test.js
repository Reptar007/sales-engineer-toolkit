/**
 * Claims on Bone Pile customers: the rules that need no database
 * (claimShape.js), the service over a fake Prisma that plays the table
 * (claimService.js), and the routes. Nothing here opens the tracked dev.db or
 * goes to the network.
 */
import { test, describe, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_NOTE_MAX_LENGTH,
  ClaimError,
  canReleaseClaim,
  claimerName,
  normalizeClaimNote,
  shapeClaim,
} from '../src/projects/maintenance-dashboard/claimShape.js';
import {
  getMaintenanceStatus,
  hasCachedSnapshot,
  resetMaintenanceCache,
  startRefresh,
} from '../src/projects/maintenance-dashboard/maintenanceService.js';

/**
 * Hermetic as maintenanceService.test.js is, and for the same reasons: the
 * routes load dotenv, and the Bone Pile's settings would change what the
 * tests see, so they are cleared by prefix, and `fetch` is a tripwire. The
 * claim service is imported late too, since it loads the Prisma client, and
 * every one of its queries goes to the fake below.
 */
const originalEnv = { ...process.env };
const { default: maintenanceRouter } = await import(
  '../src/projects/maintenance-dashboard/routes/index.js'
);
const { claimCustomer, listClaims, releaseClaim, setClaimsPrismaForTests } = await import(
  '../src/projects/maintenance-dashboard/claimService.js'
);
const OWN_PREFIXES = ['MAINTENANCE_DASHBOARD_', 'TASK_WOLF_', 'QAW_', 'QAWOLF_'];
for (const name of Object.keys(process.env)) {
  if (OWN_PREFIXES.some((prefix) => name.startsWith(prefix))) delete process.env[name];
}

const realFetch = globalThis.fetch;
const reachedFetch = [];
globalThis.fetch = async (url) => {
  reachedFetch.push(String(url));
  throw new Error(`A test reached fetch: ${url}`);
};

afterEach(() => {
  assert.deepEqual(reachedFetch.splice(0), [], 'a test sent a request to the network');
});

after(() => {
  setClaimsPrismaForTests(null);
  globalThis.fetch = realFetch;
  for (const name of Object.keys(process.env)) {
    if (!(name in originalEnv)) delete process.env[name];
  }
  Object.assign(process.env, originalEnv);
});

const NOW = Date.parse('2026-09-30T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

const NOTE = 'Rebuilding checkout flows';

/** The users table. Each has an email, so a test can prove none goes out. */
const USERS = [
  {
    id: 'u-robin',
    email: 'robin.vale@example.test',
    firstName: 'Robin',
    lastName: 'Vale',
    isActive: true,
  },
  {
    id: 'u-sam',
    email: 'sam.kestrel@example.test',
    firstName: 'Sam',
    lastName: 'Kestrel',
    isActive: true,
  },
  {
    id: 'u-jo',
    email: 'jo.marsh@example.test',
    firstName: 'Jo',
    lastName: 'Marsh',
    isActive: true,
  },
];

/** The signed-in user, as authenticateToken sets `req.user`. */
const viewer = (id, roles) => {
  const { email, firstName, lastName } = USERS.find((u) => u.id === id);
  return { id, email, firstName, lastName, roles };
};
const ROBIN = viewer('u-robin', ['sales_engineer_1']);
const SAM = viewer('u-sam', ['sales_engineer_2']);
const JO = viewer('u-jo', ['admin']);

/**
 * The snapshot as claimCustomer asks it, without a scan: its customers, and
 * the workspaces its scan could not read (`unread`, as `errors` lists them).
 */
const CUSTOMERS = [
  { workspaceId: 'ws-1', name: 'Harbor Lane' },
  { workspaceId: 'ws-2', name: 'Tidewater' },
];
const lookup = ({ hasSnapshot = true, customers = CUSTOMERS, unread = [] } = {}) => ({
  hasSnapshot: () => hasSnapshot,
  findCustomer: (id) => customers.find((c) => c.workspaceId === id) || null,
  findUnread: (id) => unread.find((e) => e.workspaceId === id) || null,
});

/** A claim as the table stores it. */
function stored({
  workspaceId = 'ws-1',
  workspaceName = 'Harbor Lane',
  userId = 'u-robin',
  note = null,
  claimedAt = NOW - DAY,
  expiresAt = NOW + 13 * DAY,
} = {}) {
  return {
    id: `seed-${workspaceId}-${userId}`,
    workspaceId,
    workspaceName,
    userId,
    note,
    expiresAt: new Date(expiresAt),
    createdAt: new Date(claimedAt),
    updatedAt: new Date(claimedAt),
  };
}

/** A fixed order for ids: by code unit. */
const byText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * A stand-in for the Prisma client that plays `maintenanceClaim` over an array
 * of rows, as the service uses it, and records every call as [method, args].
 * It understands only the `where` keys the service sends and throws on any
 * other, so a query that changes cannot pass against a fake that quietly
 * ignores it. The rows it hands back carry the whole user, email included, as
 * a careless `select` would: what goes out is up to shapeClaim. `clock` (ms)
 * is the database's now(), for createdAt and updatedAt.
 *
 * `conflictOnce` plays another tab of the same user landing its claim between
 * the service's lookup and its first upsert, which then fails as Prisma does
 * (P2002). `failWith` is thrown by every call, as by a database whose table
 * is not there.
 */
function fakePrisma({ users = USERS, rows = [], failWith = null, conflictOnce = false } = {}) {
  const calls = [];
  const table = rows.map((row) => ({ ...row }));
  let ids = 0;
  let conflict = conflictOnce;
  const fake = { calls, rows: table, clock: NOW };

  const userOf = (id) => users.find((u) => u.id === id) || null;
  const record = (method, args) => {
    calls.push([method, args]);
    if (failWith) throw failWith;
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      switch (key) {
        case 'workspaceId':
        case 'userId':
          return row[key] === value;
        case 'workspaceId_userId':
          return row.workspaceId === value.workspaceId && row.userId === value.userId;
        case 'expiresAt':
          return Object.entries(value).every(([op, bound]) => {
            if (op === 'gt') return row.expiresAt.getTime() > bound.getTime();
            if (op === 'lte') return row.expiresAt.getTime() <= bound.getTime();
            throw new Error(`fakePrisma: where.expiresAt.${op} is not modelled`);
          });
        case 'user':
          return Object.entries(value).every(([field, want]) => {
            if (field !== 'isActive')
              throw new Error(`fakePrisma: where.user.${field} is not modelled`);
            return userOf(row.userId)?.isActive === want;
          });
        default:
          throw new Error(`fakePrisma: where.${key} is not modelled`);
      }
    });
  const withUser = (row) => ({ ...row, user: userOf(row.userId) });
  const insert = (data) => {
    const now = new Date(fake.clock);
    ids += 1;
    const row = { id: `claim-${ids}`, ...data, createdAt: now, updatedAt: now };
    table.push(row);
    return row;
  };

  fake.maintenanceClaim = {
    async findMany(args) {
      record('findMany', args);
      return table
        .filter((row) => matches(row, args.where))
        .sort((a, b) => a.createdAt - b.createdAt || byText(a.id, b.id))
        .map(withUser);
    },
    async findUnique(args) {
      record('findUnique', args);
      const row = table.find((r) => matches(r, args.where));
      return row ? withUser(row) : null;
    },
    async upsert(args) {
      record('upsert', args);
      if (conflict) {
        conflict = false;
        insert(args.create);
        throw Object.assign(
          new Error('Unique constraint failed on the fields: (`workspaceId`,`userId`)'),
          { code: 'P2002' },
        );
      }
      const row = table.find((r) => matches(r, args.where));
      if (!row) return withUser(insert(args.create));
      // As Prisma does: a field given as undefined is left as it is.
      for (const [key, value] of Object.entries(args.update)) {
        if (value !== undefined) row[key] = value;
      }
      row.updatedAt = new Date(fake.clock);
      return withUser(row);
    },
    async deleteMany(args) {
      record('deleteMany', args);
      const before = table.length;
      for (let i = table.length - 1; i >= 0; i -= 1) {
        if (matches(table[i], args.where)) table.splice(i, 1);
      }
      return { count: before - table.length };
    },
  };
  return fake;
}

/** What Prisma throws when the migration has not run: it names the table. */
const tableMissing = () =>
  Object.assign(
    new Error('The table `main.maintenance_claims` does not exist in the current database.'),
    { code: 'P2021' },
  );

let fake;
/** Point every claim query at a fresh fake, and hand it back. */
const useFake = (options) => {
  fake = fakePrisma(options);
  setClaimsPrismaForTests(fake);
  return fake;
};
const methods = () => fake.calls.map(([method]) => method);
const upserts = () => fake.calls.filter(([method]) => method === 'upsert').map(([, args]) => args);

describe('normalizeClaimNote', () => {
  test('keeps a note left out as it is, and clears on null, empty or only whitespace', () => {
    assert.equal(normalizeClaimNote(undefined), undefined);
    for (const value of [null, '', '   ', '\n\t \r\n']) {
      assert.equal(normalizeClaimNote(value), null, JSON.stringify(value));
    }
  });

  test('puts a note on one line: breaks, tabs, runs of spaces and control characters', () => {
    for (const value of [
      'Rebuilding\ncheckout\tflows',
      '  Rebuilding   checkout  flows  ',
      'Rebuilding\r\ncheckout\u0000flows\u0007',
      // A C1 control, which `\s` alone would leave in.
      'Rebuilding\u0085checkout\u009fflows',
    ]) {
      assert.equal(normalizeClaimNote(value), NOTE, JSON.stringify(value));
    }
  });

  test('is at most 140 characters, counted once it is on one line', () => {
    assert.equal(CLAIM_NOTE_MAX_LENGTH, 140);
    assert.equal(normalizeClaimNote('x'.repeat(140)), 'x'.repeat(140));
    const tooLong = (value) =>
      assert.throws(
        () => normalizeClaimNote(value),
        (error) =>
          error instanceof ClaimError &&
          error.code === 'CLAIM_NOTE_INVALID' &&
          error.message === 'A note is at most 140 characters.',
      );
    tooLong('x'.repeat(141));
    // 143 as typed, 141 once the spaces collapse.
    tooLong(`${'a'.repeat(70)}   ${'b'.repeat(70)}`);
    // 150 as typed and 140 once collapsed, which is what is stored.
    const spaced = `${'a'.repeat(70)}${' '.repeat(11)}${'b'.repeat(69)}`;
    assert.equal(spaced.length, 150);
    assert.equal(normalizeClaimNote(spaced).length, 140);
  });

  test('refuses a note that is not text', () => {
    for (const value of [42, { text: NOTE }, [NOTE], true]) {
      assert.throws(
        () => normalizeClaimNote(value),
        (error) => error instanceof ClaimError && error.code === 'CLAIM_NOTE_INVALID',
        JSON.stringify(value),
      );
    }
  });
});

describe('claimerName', () => {
  test('is the first name and the last initial', () => {
    assert.equal(claimerName({ firstName: 'Robin', lastName: 'Vale' }), 'Robin V.');
    assert.equal(claimerName({ firstName: '  Robin ', lastName: '  van  Vale ' }), 'Robin V.');
  });

  test('upper-cases the initial, accented or not, and never splits a character', () => {
    assert.equal(claimerName({ firstName: 'sam', lastName: 'kestrel' }), 'sam K.');
    assert.equal(claimerName({ firstName: 'Jo', lastName: 'élan' }), 'Jo É.');
    assert.equal(claimerName({ firstName: 'Jo', lastName: '𝒱ale' }), 'Jo 𝒱.');
  });

  test('is the first name alone without a last name, and "A teammate" without a first', () => {
    assert.equal(claimerName({ firstName: 'Robin', lastName: null }), 'Robin');
    assert.equal(claimerName({ firstName: 'Robin', lastName: '   ' }), 'Robin');
    assert.equal(claimerName({ firstName: null, lastName: 'Vale' }), 'A teammate');
    assert.equal(claimerName(null), 'A teammate');
  });

  test('never falls back on the email', () => {
    const name = claimerName({ email: 'robin.vale@example.test', firstName: ' ', lastName: '' });
    assert.equal(name, 'A teammate');
    assert.ok(!name.includes('@'));
  });
});

describe('shapeClaim', () => {
  const row = {
    ...stored({ note: NOTE, claimedAt: NOW, expiresAt: NOW + 14 * DAY }),
    user: USERS[0],
  };

  test('sends exactly the fields the page reads, and nothing about the claimer but a name', () => {
    const shaped = shapeClaim(row, ROBIN);
    assert.deepEqual(shaped, {
      workspaceId: 'ws-1',
      workspaceName: 'Harbor Lane',
      userId: 'u-robin',
      claimer: 'Robin V.',
      note: NOTE,
      claimedAt: iso(NOW),
      expiresAt: iso(NOW + 14 * DAY),
      mine: true,
      canRelease: true,
    });
    const sent = JSON.stringify(shaped);
    assert.ok(!sent.includes('@'), sent);
    assert.ok(!sent.includes('Vale'), sent);
    assert.ok(!sent.includes('seed-'), 'the row id stays in the database');
  });

  test('works out `mine` and `canRelease` for the owner, another SE and an admin', () => {
    const seen = (who) => {
      const { mine, canRelease } = shapeClaim(row, who);
      return { mine, canRelease };
    };
    assert.deepEqual(seen(ROBIN), { mine: true, canRelease: true });
    assert.deepEqual(seen(SAM), { mine: false, canRelease: false });
    assert.deepEqual(seen(JO), { mine: false, canRelease: true });
  });

  test('a claim with no name of its customer or no note sends null for them', () => {
    const bare = shapeClaim({ ...row, workspaceName: undefined, note: undefined }, SAM);
    assert.equal(bare.workspaceName, null);
    assert.equal(bare.note, null);
  });

  test('nobody may release a claim on the strength of having no id', () => {
    assert.equal(canReleaseClaim({ roles: [] }, undefined), false);
    assert.equal(canReleaseClaim(undefined, undefined), false);
  });
});

describe('claimService', () => {
  beforeEach(() => {
    resetMaintenanceCache();
    mock.method(console, 'error', () => {});
    useFake();
  });

  afterEach(() => mock.restoreAll());

  test('a claim lasts 14 days from when it was made, under the customer’s snapshot name', async () => {
    const res = await claimCustomer(ROBIN, 'ws-1', NOTE, { now: NOW, lookup: lookup() });
    assert.equal(res.renewed, false);
    assert.deepEqual(res.claim, {
      workspaceId: 'ws-1',
      workspaceName: 'Harbor Lane',
      userId: 'u-robin',
      claimer: 'Robin V.',
      note: NOTE,
      claimedAt: iso(NOW),
      expiresAt: iso(NOW + 14 * DAY),
      mine: true,
      canRelease: true,
    });
    assert.equal(res.claimDays, 14);
    assert.equal(res.noteMaxLength, 140);
    assert.deepEqual(res.claims, [res.claim]);
    assert.equal(fake.rows.length, 1);
    assert.equal(fake.rows[0].workspaceName, 'Harbor Lane');
    // The caller's claim is looked up, lapsed claims go, then the write and the list.
    assert.deepEqual(methods(), ['findUnique', 'deleteMany', 'upsert', 'findMany']);
  });

  test('a renewal keeps when it was claimed, moves the expiry on, and keeps, replaces or clears the note', async () => {
    await claimCustomer(ROBIN, 'ws-1', NOTE, { now: NOW, lookup: lookup() });
    const later = NOW + 3 * DAY;
    fake.clock = later;

    const kept = await claimCustomer(ROBIN, 'ws-1', undefined, { now: later, lookup: lookup() });
    assert.equal(kept.renewed, true);
    assert.equal(kept.claim.claimedAt, iso(NOW));
    assert.equal(kept.claim.expiresAt, iso(later + 14 * DAY));
    assert.equal(kept.claim.note, NOTE);
    // Left out, the note is not written at all: Prisma leaves an undefined field alone.
    const update = upserts().at(-1).update;
    assert.equal(update.note, undefined);
    assert.equal(update.expiresAt.toISOString(), iso(later + 14 * DAY));

    const replaced = await claimCustomer(ROBIN, 'ws-1', ' Rebuilding\nlogin flows ', {
      now: later,
      lookup: lookup(),
    });
    assert.equal(replaced.claim.note, 'Rebuilding login flows');

    const cleared = await claimCustomer(ROBIN, 'ws-1', null, { now: later, lookup: lookup() });
    assert.equal(cleared.claim.note, null);
    assert.equal(cleared.claim.claimedAt, iso(NOW));
    assert.equal(fake.rows.length, 1);

    // A renewal writes the customer's name as the snapshot has it now, so a
    // claim whose customer later leaves the snapshot is named as it last was.
    const renamed = await claimCustomer(ROBIN, 'ws-1', undefined, {
      now: later,
      lookup: lookup({ customers: [{ workspaceId: 'ws-1', name: 'Harbor Lane Co' }] }),
    });
    assert.equal(renamed.claim.workspaceName, 'Harbor Lane Co');
    assert.equal(fake.rows[0].workspaceName, 'Harbor Lane Co');
  });

  test('several SEs can claim one customer, and each sees which claim is theirs', async () => {
    await claimCustomer(ROBIN, 'ws-1', NOTE, { now: NOW, lookup: lookup() });
    fake.clock = NOW + HOUR;
    const sams = await claimCustomer(SAM, 'ws-1', undefined, { now: NOW + HOUR, lookup: lookup() });
    assert.equal(sams.renewed, false, "another SE's claim is not a renewal of the first");
    assert.equal(sams.claim.claimer, 'Sam K.');

    const seenBy = async (who) =>
      (await listClaims(who, { now: NOW + HOUR })).claims.map((c) => [
        c.claimer,
        c.mine,
        c.canRelease,
      ]);
    assert.deepEqual(await seenBy(ROBIN), [
      ['Robin V.', true, true],
      ['Sam K.', false, false],
    ]);
    assert.deepEqual(await seenBy(SAM), [
      ['Robin V.', false, false],
      ['Sam K.', true, true],
    ]);
    assert.deepEqual(await seenBy(JO), [
      ['Robin V.', false, true],
      ['Sam K.', false, true],
    ]);
  });

  test('the list is read without the email, oldest first, lapsed claims and inactive users left out', async () => {
    await listClaims(ROBIN, { now: NOW });
    const [[method, args]] = fake.calls;
    assert.equal(method, 'findMany');
    assert.deepEqual(args.where, { expiresAt: { gt: new Date(NOW) }, user: { isActive: true } });
    assert.deepEqual(args.select.user, { select: { firstName: true, lastName: true } });
    assert.ok(!('email' in args.select));
    assert.deepEqual(args.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  test('a lapsed claim stops counting at once, and the next write deletes it', async () => {
    useFake({
      rows: [
        stored({ userId: 'u-robin', claimedAt: NOW - 20 * DAY, expiresAt: NOW - 1 }),
        // Lapsing this very moment is lapsed.
        stored({ workspaceId: 'ws-2', userId: 'u-jo', expiresAt: NOW }),
        stored({ workspaceId: 'ws-2', userId: 'u-sam' }),
      ],
    });
    const listed = await listClaims(ROBIN, { now: NOW });
    assert.deepEqual(
      listed.claims.map((c) => c.userId),
      ['u-sam'],
    );
    assert.equal(fake.rows.length, 3, 'a read deletes nothing');

    await claimCustomer(SAM, 'ws-1', undefined, { now: NOW, lookup: lookup() });
    const prune = fake.calls.findIndex(
      ([method, args]) => method === 'deleteMany' && args.where.expiresAt?.lte,
    );
    assert.ok(
      prune >= 0 && prune < methods().indexOf('upsert'),
      'lapsed claims go before the write',
    );
    assert.deepEqual(fake.calls[prune][1].where, { expiresAt: { lte: new Date(NOW) } });
    assert.deepEqual(fake.rows.map((r) => r.userId).sort(), ['u-sam', 'u-sam']);

    // Claimed again after it lapsed, it is a new claim, from now.
    const again = await claimCustomer(ROBIN, 'ws-1', undefined, { now: NOW, lookup: lookup() });
    assert.equal(again.renewed, false);
    assert.equal(again.claim.claimedAt, iso(NOW));
    assert.equal(again.claim.expiresAt, iso(NOW + 14 * DAY));
  });

  test('MAINTENANCE_DASHBOARD_CLAIM_DAYS sets how long new claims and renewals last, and moves no claim already made', async (t) => {
    t.after(() => delete process.env.MAINTENANCE_DASHBOARD_CLAIM_DAYS);
    await claimCustomer(ROBIN, 'ws-1', undefined, { now: NOW, lookup: lookup() });

    process.env.MAINTENANCE_DASHBOARD_CLAIM_DAYS = '3';
    const listed = await listClaims(ROBIN, { now: NOW });
    assert.equal(listed.claimDays, 3);
    assert.equal(listed.claims[0].expiresAt, iso(NOW + 14 * DAY));

    const sams = await claimCustomer(SAM, 'ws-1', undefined, { now: NOW, lookup: lookup() });
    assert.equal(sams.claim.expiresAt, iso(NOW + 3 * DAY));

    const renewed = await claimCustomer(ROBIN, 'ws-1', undefined, {
      now: NOW + DAY,
      lookup: lookup(),
    });
    assert.equal(renewed.claim.expiresAt, iso(NOW + 4 * DAY));
  });

  test('refuses before the database is asked: no snapshot, a customer not in it, a note that is not one', async () => {
    const refused = async (code, whoAndWhat, options) => {
      useFake({ rows: [stored({ userId: 'u-sam' })] });
      await assert.rejects(
        claimCustomer(...whoAndWhat, { now: NOW, lookup: lookup(), ...options }),
        (error) => error instanceof ClaimError && error.code === code,
        code,
      );
      assert.deepEqual(fake.calls, [], `${code}: nothing asked of the database`);
      assert.equal(fake.rows.length, 1, `${code}: nothing written`);
    };
    await refused('CLAIM_NO_SNAPSHOT', [ROBIN, 'ws-1', NOTE], {
      lookup: lookup({ hasSnapshot: false }),
    });
    await refused('CLAIM_UNKNOWN_CUSTOMER', [ROBIN, 'ws-nope', NOTE]);
    await refused('CLAIM_NOTE_INVALID', [ROBIN, 'ws-1', 'x'.repeat(141)]);
    await refused('CLAIM_NOTE_INVALID', [ROBIN, 'ws-1', 42]);
    // The note is looked at first, snapshot or none.
    await refused('CLAIM_NOTE_INVALID', [ROBIN, 'ws-1', 42], {
      lookup: lookup({ hasSnapshot: false }),
    });
  });

  test('a customer the scan could not read: a claim on it is renewed, a new one refused before anything is written', async () => {
    // Tidewater's reports failed to load, so the snapshot has it only in `errors`.
    const unreadLookup = () =>
      lookup({
        customers: CUSTOMERS.filter((c) => c.workspaceId !== 'ws-2'),
        unread: [
          { workspaceId: 'ws-2', workspaceName: 'Tidewater', message: 'QA Wolf returned 502' },
        ],
      });
    const seeded = [
      stored({ workspaceId: 'ws-2', workspaceName: 'Tidewater', userId: 'u-sam', note: NOTE }),
      // Robin's lapsed a moment ago, so a claim from him now would be a new one.
      stored({ workspaceId: 'ws-2', workspaceName: 'Tidewater', expiresAt: NOW - 1 }),
    ];

    // Robin's lapsed claim is not one to renew, and Jo has none.
    for (const who of [ROBIN, JO]) {
      useFake({ rows: seeded });
      await assert.rejects(
        claimCustomer(who, 'ws-2', NOTE, { now: NOW, lookup: unreadLookup() }),
        (error) =>
          error instanceof ClaimError &&
          error.code === 'CLAIM_CUSTOMER_UNREAD' &&
          /couldn't read this customer/.test(error.message),
        who.id,
      );
      // Only the caller's claim was looked up; nothing was written or pruned.
      assert.deepEqual(methods(), ['findUnique'], who.id);
      assert.deepEqual(fake.rows, seeded, who.id);
    }

    const renewed = await claimCustomer(SAM, 'ws-2', undefined, {
      now: NOW,
      lookup: unreadLookup(),
    });
    assert.equal(renewed.renewed, true);
    assert.equal(renewed.claim.expiresAt, iso(NOW + 14 * DAY));
    assert.equal(renewed.claim.note, NOTE);
    assert.equal(renewed.claim.workspaceName, 'Tidewater');
    assert.deepEqual(
      fake.rows.map((r) => r.userId),
      ['u-sam'],
      'the renewal pruned the lapsed claim',
    );
  });

  test('a renewal of a customer the scan could not read keeps the claim’s name when QA Wolf gave none', async () => {
    useFake({ rows: [stored({ workspaceId: 'ws-2', workspaceName: 'Tidewater' })] });
    const res = await claimCustomer(ROBIN, 'ws-2', undefined, {
      now: NOW,
      lookup: lookup({ customers: [], unread: [{ workspaceId: 'ws-2', message: 'timed out' }] }),
    });
    assert.equal(res.renewed, true);
    assert.equal(res.claim.workspaceName, 'Tidewater');
    assert.equal(upserts()[0].update.workspaceName, undefined);
  });

  test('an SE releases their own claim, and only theirs; a claim already gone is no failure', async () => {
    useFake({
      rows: [
        stored({ userId: 'u-robin' }),
        stored({ userId: 'u-sam', claimedAt: NOW - 2 * DAY }),
        stored({ workspaceId: 'ws-2' }),
      ],
    });
    const released = await releaseClaim(ROBIN, 'ws-1', 'u-robin', { now: NOW });
    assert.equal(released.released, true);
    // Sam's claim on the same customer stays, and the list is as Robin sees it.
    assert.deepEqual(
      fake.rows.map((r) => [r.workspaceId, r.userId]),
      [
        ['ws-1', 'u-sam'],
        ['ws-2', 'u-robin'],
      ],
    );
    assert.deepEqual(
      released.claims.map((c) => [c.workspaceId, c.claimer, c.mine, c.canRelease]),
      [
        ['ws-1', 'Sam K.', false, false],
        ['ws-2', 'Robin V.', true, true],
      ],
    );
    assert.equal(released.claimDays, 14);
    assert.equal((await releaseClaim(ROBIN, 'ws-1', 'u-robin', { now: NOW })).released, false);
  });

  test('a claim that has lapsed but is still stored is not released: lapsed claims go first', async () => {
    useFake({
      rows: [
        stored({ userId: 'u-robin', expiresAt: NOW - 1 }),
        stored({ workspaceId: 'ws-2', userId: 'u-sam', expiresAt: NOW - DAY }),
      ],
    });
    const res = await releaseClaim(ROBIN, 'ws-1', 'u-robin', { now: NOW });
    assert.equal(res.released, false);
    assert.deepEqual(res.claims, []);
    assert.deepEqual(fake.rows, [], "every lapsed claim went, Sam's included");
    assert.deepEqual(
      fake.calls.filter(([method]) => method === 'deleteMany').map(([, args]) => args.where),
      [{ expiresAt: { lte: new Date(NOW) } }, { workspaceId: 'ws-1', userId: 'u-robin' }],
    );
  });

  test("an SE cannot release another's claim, and the database is not asked; an admin can", async () => {
    useFake({ rows: [stored({ userId: 'u-sam' })] });
    await assert.rejects(
      releaseClaim(ROBIN, 'ws-1', 'u-sam', { now: NOW }),
      (error) => error instanceof ClaimError && error.code === 'CLAIM_NOT_YOURS',
    );
    assert.deepEqual(fake.calls, []);
    assert.equal(fake.rows.length, 1);

    const cleared = await releaseClaim(JO, 'ws-1', 'u-sam', { now: NOW });
    assert.equal(cleared.released, true);
    assert.equal(fake.rows.length, 0);
  });

  test('release asks nothing of the snapshot, so it works with none cached', async () => {
    useFake({ rows: [stored({ userId: 'u-robin' })] });
    assert.equal(hasCachedSnapshot(), false);
    const res = await releaseClaim(ROBIN, 'ws-1', 'u-robin', { now: NOW });
    assert.equal(res.released, true);
  });

  test('a deactivated user’s claim is hidden', async () => {
    useFake({
      users: USERS.map((u) => (u.id === 'u-sam' ? { ...u, isActive: false } : u)),
      rows: [stored({ userId: 'u-sam' }), stored({ workspaceId: 'ws-2', userId: 'u-robin' })],
    });
    const { claims } = await listClaims(JO, { now: NOW });
    assert.deepEqual(
      claims.map((c) => c.userId),
      ['u-robin'],
    );
  });

  test('two tabs claiming at once: the write that loses the race renews the row that won it', async () => {
    useFake({ conflictOnce: true });
    const res = await claimCustomer(ROBIN, 'ws-1', NOTE, { now: NOW, lookup: lookup() });
    assert.equal(res.renewed, true);
    assert.equal(res.claim.note, NOTE);
    assert.equal(upserts().length, 2);
    assert.equal(fake.rows.length, 1);
  });

  test('a failure other than the race is thrown as it came', async () => {
    useFake({ failWith: tableMissing() });
    await assert.rejects(listClaims(ROBIN, { now: NOW }), /maintenance_claims/);
    await assert.rejects(
      claimCustomer(ROBIN, 'ws-1', NOTE, { now: NOW, lookup: lookup() }),
      /maintenance_claims/,
    );
  });
});

/**
 * The route's own handler, past the session check, and a `res` that records
 * what it was told. Nothing listens on a port.
 */
function routeHandler(method, path) {
  const layer = maintenanceRouter.stack.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  return layer.route.stack.at(-1).handle;
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

/**
 * A QA Wolf with the two customers, one open report each, so a scan has
 * something to publish. The reports of a workspace in `failing` cannot be
 * read, so the snapshot lists it only in `errors`.
 */
function qawolfClient({ failing = [] } = {}) {
  const listed = [
    { id: 'ws-1', name: 'Harbor Lane', slug: 'harbor-lane', organizationName: 'Harbor Lane' },
    { id: 'ws-2', name: 'Tidewater', slug: 'tidewater', organizationName: 'Tidewater' },
  ];
  return {
    listWorkspaces: async () => listed,
    listOpenMaintenanceReports: async (workspaceId) => {
      if (failing.includes(workspaceId)) {
        throw Object.assign(new Error('QA Wolf issue.find returned 502'), {
          code: 'QAW_UPSTREAM',
        });
      }
      return {
        issues: [
          {
            issueId: `i-${workspaceId}`,
            number: 1,
            name: 'Checkout total',
            status: 'pending',
            createdAt: new Date(Date.now() - 20 * DAY).toISOString(),
            reproductions: [{ flowId: `f-${workspaceId}` }],
          },
        ],
        truncated: false,
      };
    },
  };
}
const scan = (options) => startRefresh({ client: qawolfClient(options), taskWolfClient: null });

describe('the claim routes', () => {
  const getClaims = routeHandler('get', '/claims');
  const putClaim = routeHandler('put', '/claims/:workspaceId');
  const deleteClaim = routeHandler('delete', '/claims/:workspaceId/:userId');

  const get = async (user) => {
    const res = fakeRes();
    await getClaims({ user }, res);
    return res;
  };
  const put = async (user, workspaceId, body) => {
    const res = fakeRes();
    await putClaim({ user, params: { workspaceId }, body }, res);
    return res;
  };
  const del = async (user, workspaceId, userId) => {
    const res = fakeRes();
    await deleteClaim({ user, params: { workspaceId, userId } }, res);
    return res;
  };

  beforeEach(() => {
    resetMaintenanceCache();
    mock.method(console, 'error', () => {});
    useFake();
    fake.clock = Date.now();
  });

  afterEach(() => mock.restoreAll());

  test('GET /claims lists every claim as the caller sees it, with how long one lasts and how long a note may be', async () => {
    useFake({ rows: [stored({ claimedAt: Date.now(), expiresAt: Date.now() + DAY })] });
    const res = await get(SAM);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.claimDays, 14);
    assert.equal(res.body.noteMaxLength, 140);
    // Robin's claim, to Sam, to Robin and to an admin.
    const seenBy = async (who) =>
      (await get(who)).body.claims.map((c) => [c.claimer, c.mine, c.canRelease]);
    assert.deepEqual(await seenBy(SAM), [['Robin V.', false, false]]);
    assert.deepEqual(await seenBy(ROBIN), [['Robin V.', true, true]]);
    assert.deepEqual(await seenBy(JO), [['Robin V.', false, true]]);
  });

  test('PUT claims a customer in the snapshot, and says when it was a renewal', async () => {
    await scan();
    const first = await put(ROBIN, 'ws-1', { note: NOTE });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.renewed, false);
    assert.equal(first.body.claim.workspaceName, 'Harbor Lane');
    assert.equal(first.body.claim.note, NOTE);
    assert.equal(first.body.claimDays, 14);

    // No body at all, as Express 5 leaves it: renewed, and the note kept.
    const again = await put(ROBIN, 'ws-1', undefined);
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.renewed, true);
    assert.equal(again.body.claim.note, NOTE);
  });

  test('PUT refuses a note too long (400), anything before the first scan (409) and a customer not in the snapshot (404)', async () => {
    const early = await put(ROBIN, 'ws-1', { note: NOTE });
    assert.equal(early.statusCode, 409);
    assert.deepEqual(Object.keys(early.body).sort(), ['code', 'error', 'status']);
    assert.equal(early.body.status, 'error');
    assert.equal(early.body.code, 'CLAIM_NO_SNAPSHOT');
    assert.match(early.body.error, /restarted and hasn't loaded the backlog since/);
    // The claim route starts no scan; asking for the backlog (GET /) does.
    assert.equal(getMaintenanceStatus().refreshing, false);

    await scan();
    const long = await put(ROBIN, 'ws-1', { note: 'x'.repeat(141) });
    assert.equal(long.statusCode, 400);
    assert.equal(long.body.code, 'CLAIM_NOTE_INVALID');

    const unknown = await put(ROBIN, 'ws-nope', { note: NOTE });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.body.code, 'CLAIM_UNKNOWN_CUSTOMER');
    assert.deepEqual(fake.rows, [], 'nothing was written');
  });

  test('PUT on a customer the scan could not read renews a claim on it, and refuses a new one (409)', async () => {
    await scan({ failing: ['ws-2'] });
    useFake({
      rows: [
        stored({
          workspaceId: 'ws-2',
          workspaceName: 'Tidewater',
          userId: 'u-sam',
          claimedAt: Date.now() - DAY,
          expiresAt: Date.now() + HOUR,
        }),
      ],
    });

    const fresh = await put(ROBIN, 'ws-2', { note: NOTE });
    assert.equal(fresh.statusCode, 409);
    assert.equal(fresh.body.code, 'CLAIM_CUSTOMER_UNREAD');
    assert.equal(fake.rows.length, 1, 'nothing was written');

    const renewal = await put(SAM, 'ws-2', undefined);
    assert.equal(renewal.statusCode, 200);
    assert.equal(renewal.body.renewed, true);
    assert.equal(renewal.body.claim.workspaceName, 'Tidewater');
    assert.ok(Date.parse(renewal.body.claim.expiresAt) > Date.now() + 13 * DAY);

    // A workspace QA Wolf never listed is still no customer.
    assert.equal((await put(ROBIN, 'ws-nope', undefined)).statusCode, 404);
  });

  test("DELETE of another SE's claim is 403 for an SE, and done for an admin, who leaves the rest", async () => {
    useFake({
      rows: [
        stored({ userId: 'u-sam', claimedAt: Date.now(), expiresAt: Date.now() + DAY }),
        stored({ userId: 'u-robin', claimedAt: Date.now(), expiresAt: Date.now() + DAY }),
      ],
    });
    const refused = await del(ROBIN, 'ws-1', 'u-sam');
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.body.code, 'CLAIM_NOT_YOURS');
    assert.equal(fake.rows.length, 2);

    const done = await del(JO, 'ws-1', 'u-sam');
    assert.equal(done.statusCode, 200);
    assert.equal(done.body.released, true);
    // Robin's claim on the same customer stays, as the admin sees it.
    assert.deepEqual(
      done.body.claims.map((c) => [c.workspaceId, c.userId, c.mine, c.canRelease]),
      [['ws-1', 'u-robin', false, true]],
    );

    const gone = await del(JO, 'ws-1', 'u-sam');
    assert.equal(gone.statusCode, 200);
    assert.equal(gone.body.released, false);
  });

  test('a database failure is 500 CLAIMS_UNAVAILABLE, logged, and says nothing of the database', async () => {
    await scan();
    useFake({ failWith: tableMissing() });
    const answers = [
      [await get(ROBIN), 'Claims could not be read.'],
      [await put(ROBIN, 'ws-1', { note: NOTE }), 'The claim could not be saved.'],
      [await del(ROBIN, 'ws-1', 'u-robin'), 'The claim could not be released.'],
    ];
    for (const [res, message] of answers) {
      assert.equal(res.statusCode, 500, message);
      assert.deepEqual(res.body, { status: 'error', error: message, code: 'CLAIMS_UNAVAILABLE' });
      assert.ok(!JSON.stringify(res.body).includes('maintenance_claims'), message);
    }
    assert.equal(console.error.mock.calls.length, 3);
    assert.match(String(console.error.mock.calls[0].arguments[1].message), /maintenance_claims/);
  });

  test('claims bypass the snapshot: a claim shows on the next GET, and nothing is rescanned', async () => {
    await scan();
    const before = getMaintenanceStatus();
    assert.equal((await put(SAM, 'ws-2', { note: NOTE })).statusCode, 200);

    const listed = await get(ROBIN);
    assert.deepEqual(
      listed.body.claims.map((c) => [c.workspaceId, c.claimer, c.note, c.mine]),
      [['ws-2', 'Sam K.', NOTE, false]],
    );
    const after = getMaintenanceStatus();
    assert.equal(after.builtAt, before.builtAt);
    assert.equal(after.refreshing, false);
  });

  test('no answer carries an email', async () => {
    await scan();
    const bodies = [
      (await put(ROBIN, 'ws-1', { note: NOTE })).body,
      (await put(SAM, 'ws-1', undefined)).body,
      (await put(JO, 'ws-2', { note: null })).body,
      (await get(JO)).body,
      (await del(JO, 'ws-1', 'u-sam')).body,
    ];
    assert.equal(bodies[3].claims.length, 3);
    for (const body of bodies) {
      const sent = JSON.stringify(body);
      assert.ok(!sent.includes('@'), sent);
    }
  });
});
