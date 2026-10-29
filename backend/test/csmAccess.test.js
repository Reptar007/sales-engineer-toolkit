/**
 * Customer success access: CSM accounts see their self-serve clients and
 * Lone Wolves, read-only, and nothing built for SEs; only admins and the
 * CSM lead change Lone Wolves (Becca, 10/28).
 *
 * These pin the rules on both sides: the server's (blockCsm, the Lone Wolves
 * editor check) and the page's (frontend/src/utils/roles.js and the client
 * filter in onboardingView.js), which must agree.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ROLES, checkRoleChange, isCsmOnly, makeBlockCsm } from '../src/middleware/rbac.js';
import { generateJWT } from '../src/utlis/jwt.js';
import {
  canEditLoneWolves,
  canPriceLoneWolves,
  requireDetailsAccess,
} from '../src/projects/lone-wolves/routes/index.js';
import * as pageRoles from '../../frontend/src/utils/roles.js';
import { clientsFor } from '../../frontend/src/projects/lone-wolves/onboardingView.js';

before(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
});

/**
 * A token for an account whose roles in the database are `roles`. The token
 * itself carries `tokenRoles` (the same unless given), so a test can show the
 * database wins once an admin changes someone's roles.
 */
const stored = new Map();
let nextId = 0;
function tokenFor(roles, tokenRoles = roles) {
  const id = `u${(nextId += 1)}`;
  stored.set(id, roles);
  return generateJWT({ id, email: 'someone@qawolf.com' }, tokenRoles);
}
const blockCsm = makeBlockCsm(async (id) => stored.get(id) || []);

/** Run a middleware on a request and say whether it let it through, or the status it answered. */
async function runWith(middleware, req) {
  let status = null;
  let passed = false;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  await middleware({ cookies: {}, headers: {}, ...req }, res, () => {
    passed = true;
  });
  return passed ? 'next' : status;
}

const run = (headers = {}) => runWith(blockCsm, { headers });

describe('who counts as customer success only', () => {
  test('csm or csm_lead alone, not mixed with another role', () => {
    assert.equal(isCsmOnly(['csm']), true);
    assert.equal(isCsmOnly(['csm_lead']), true);
    assert.equal(isCsmOnly(['csm', 'sales_engineer_1']), false);
    assert.equal(isCsmOnly(['admin']), false);
    assert.equal(isCsmOnly([]), false);
  });

  test('the page agrees with the server', () => {
    for (const roles of [['csm'], ['csm_lead'], ['csm', 'admin'], ['sales_engineer_2'], []]) {
      assert.equal(pageRoles.isCsmOnly({ roles }), isCsmOnly(roles), roles.join(','));
    }
  });
});

describe('SE routers turn a CSM token away', () => {
  test('a CSM token gets 403', async () => {
    assert.equal(await run({ authorization: `Bearer ${tokenFor(['csm'])}` }), 403);
    assert.equal(await run({ authorization: `Bearer ${tokenFor(['csm_lead'])}` }), 403);
  });

  test('SEs, admins and CSMs with another role pass through', async () => {
    assert.equal(await run({ authorization: `Bearer ${tokenFor(['sales_engineer_1'])}` }), 'next');
    assert.equal(await run({ authorization: `Bearer ${tokenFor(['admin'])}` }), 'next');
    assert.equal(
      await run({ authorization: `Bearer ${tokenFor(['csm', 'sales_engineer_2'])}` }),
      'next',
    );
  });

  test('roles an admin changed apply at once, whatever the token says', async () => {
    // An SE moved to CSM is blocked without signing in again...
    assert.equal(
      await run({ authorization: `Bearer ${tokenFor(['csm'], ['sales_engineer_1'])}` }),
      403,
    );
    // ...and a CSM given an SE role gets in.
    assert.equal(
      await run({ authorization: `Bearer ${tokenFor(['sales_engineer_1'], ['csm'])}` }),
      'next',
    );
  });

  test('no token or a bad one is left to the router’s own auth (public routes stay public)', async () => {
    assert.equal(await run({}), 'next');
    assert.equal(await run({ authorization: 'Bearer not-a-token' }), 'next');
  });
});

describe('admins change an account’s roles', () => {
  test('any known roles, deduplicated', () => {
    assert.deepEqual(checkRoleChange(['csm', 'csm'], { userId: 'a', editorId: 'b' }), {
      roles: ['csm'],
    });
    assert.deepEqual(checkRoleChange(ALL_ROLES, { userId: 'a', editorId: 'b' }).roles, ALL_ROLES);
  });

  test('not none, not unknown ones, and not their own admin role', () => {
    assert.ok(checkRoleChange([], { userId: 'a', editorId: 'b' }).error);
    assert.ok(checkRoleChange('csm', { userId: 'a', editorId: 'b' }).error);
    assert.match(checkRoleChange(['wizard'], { userId: 'a', editorId: 'b' }).error, /wizard/);
    assert.match(checkRoleChange(['csm'], { userId: 'a', editorId: 'a' }).error, /own admin/);
    assert.deepEqual(checkRoleChange(['admin', 'csm'], { userId: 'a', editorId: 'a' }).roles, [
      'admin',
      'csm',
    ]);
  });

  test('the forms offer exactly the roles the server accepts', () => {
    assert.deepEqual(pageRoles.ROLE_OPTIONS.map((o) => o.value).sort(), [...ALL_ROLES].sort());
  });
});

describe('who switches a workspace’s pricing', () => {
  const details = (roles, body) => runWith(requireDetailsAccess, { user: { roles }, body });

  test('CSMs switch pricing and nothing else', async () => {
    assert.equal(await details(['csm'], { pricing: 'new' }), 'next');
    assert.equal(await details(['csm'], { pricing: 'new', nextStep: 'x' }), 403);
    assert.equal(await details(['csm'], { hidden: true }), 403);
  });

  test('editors change anything; SEs change nothing', async () => {
    assert.equal(await details(['csm_lead'], { hidden: true }), 'next');
    assert.equal(await details(['admin'], { pricing: 'old', nextStep: 'x' }), 'next');
    assert.equal(await details(['sales_engineer_1'], { pricing: 'new' }), 403);
  });

  test('the page agrees with the server', () => {
    for (const roles of [['admin'], ['csm_lead'], ['csm'], ['sales_engineer_1'], []]) {
      assert.equal(
        pageRoles.canPriceLoneWolves({ roles }),
        canPriceLoneWolves({ roles }),
        roles.join(','),
      );
    }
  });
});

describe('who edits Lone Wolves', () => {
  test('admins and the CSM lead; CSMs and SEs read', () => {
    assert.equal(canEditLoneWolves({ roles: ['admin'] }), true);
    assert.equal(canEditLoneWolves({ roles: ['csm_lead'] }), true);
    assert.equal(canEditLoneWolves({ roles: ['csm'] }), false);
    assert.equal(canEditLoneWolves({ roles: ['sales_engineer_lead'] }), false);
    assert.equal(canEditLoneWolves({}), false);
  });

  test('the page agrees with the server', () => {
    for (const roles of [['admin'], ['csm_lead'], ['csm'], ['sales_engineer_1']]) {
      assert.equal(pageRoles.canEditLoneWolves({ roles }), canEditLoneWolves({ roles }));
    }
  });
});

describe('a CSM’s clients', () => {
  const rows = [
    { workspaceId: 'a', csm: 'Owen Smith' },
    { workspaceId: 'b', csm: 'owen  smith ' },
    { workspaceId: 'c', csm: 'anna@qawolf.com' },
    { workspaceId: 'd', csm: null },
  ];

  test('rows whose CSM is them, by name or email, however spaced or cased', () => {
    const ids = (list) => list.map((r) => r.workspaceId);
    assert.deepEqual(ids(clientsFor(rows, { name: 'Owen Smith', email: 'owen@qawolf.com' })), [
      'a',
      'b',
    ]);
    assert.deepEqual(ids(clientsFor(rows, { name: 'Anna Knight', email: 'anna@qawolf.com' })), [
      'c',
    ]);
    assert.deepEqual(ids(clientsFor(rows, { name: '', email: '' })), []);
  });

  test('the CSM lead and admins see every client', () => {
    assert.equal(clientsFor(rows, { all: true }).length, 4);
    assert.equal(pageRoles.seesAllClients({ roles: ['csm_lead'] }), true);
    assert.equal(pageRoles.seesAllClients({ roles: ['csm'] }), false);
  });

  test('a CSM-only account may open only its home, Lone Wolves and the password page', () => {
    assert.deepEqual([...pageRoles.CSM_PATHS].sort(), [
      '/',
      '/change-password',
      '/projects/lone-wolves',
    ]);
    assert.equal(pageRoles.fullName({ firstName: 'Kyla', lastName: 'Jeffrey' }), 'Kyla Jeffrey');
  });
});
