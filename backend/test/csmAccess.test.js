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
import { blockCsm, isCsmOnly } from '../src/middleware/rbac.js';
import { generateJWT } from '../src/utlis/jwt.js';
import { canEditLoneWolves } from '../src/projects/lone-wolves/routes/index.js';
import * as pageRoles from '../../frontend/src/utils/roles.js';
import { clientsFor } from '../../frontend/src/projects/lone-wolves/onboardingView.js';

before(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
});

const tokenFor = (roles) => generateJWT({ id: 'u1', email: 'someone@qawolf.com' }, roles);

/** Run blockCsm on a request and say whether it let it through, or the status it answered. */
function run(headers = {}) {
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
  blockCsm({ headers, cookies: {} }, res, () => {
    passed = true;
  });
  return passed ? 'next' : status;
}

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
  test('a CSM token gets 403', () => {
    assert.equal(run({ authorization: `Bearer ${tokenFor(['csm'])}` }), 403);
    assert.equal(run({ authorization: `Bearer ${tokenFor(['csm_lead'])}` }), 403);
  });

  test('SEs, admins and CSMs with another role pass through', () => {
    assert.equal(run({ authorization: `Bearer ${tokenFor(['sales_engineer_1'])}` }), 'next');
    assert.equal(run({ authorization: `Bearer ${tokenFor(['admin'])}` }), 'next');
    assert.equal(run({ authorization: `Bearer ${tokenFor(['csm', 'sales_engineer_2'])}` }), 'next');
  });

  test('no token or a bad one is left to the router’s own auth (public routes stay public)', () => {
    assert.equal(run({}), 'next');
    assert.equal(run({ authorization: 'Bearer not-a-token' }), 'next');
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
