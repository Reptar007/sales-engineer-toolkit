/**
 * Seeding CARR attributions from the SE handoff log.
 *
 * These rules decide which SE is credited with real revenue, and the log
 * disagrees with Salesforce on almost every name, so the interesting cases are
 * all about refusing to guess: an ambiguous client name, a replier who isn't an
 * SE, and a name attached to a handoff that didn't happen.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  parseCsv,
  matchOpportunity,
  resolveCredit,
  resolveHandoffLog,
  planWrites,
} from '../src/projects/salesforce/carrAttributionSeed.js';

const opp = (id, opportunityName, carrAmount = 1000, fiscalPeriod = 'Q1-2026') => ({
  opportunityId: id,
  opportunityName,
  carrAmount,
  fiscalPeriod,
  salesEngineerId: null,
});

const SES = [
  { id: 'se-becca', name: 'Becca Stone' },
  { id: 'se-dion', name: 'Dion Pham' },
  { id: 'se-seb', name: 'Sebastian Antonucci' },
];
const byFirst = new Map(SES.map((s) => [s.name.split(' ')[0].toLowerCase(), s]));

describe('parseCsv', () => {
  test('keeps commas that live inside a quoted note', () => {
    // The real log has notes like "Done; pilot 200 primary web tests, annual
    // 400 plus 50 secondary" -- splitting on commas shifts every later column.
    const rows = parseCsv(
      'client,se_reply,has_se_handoff,notes\n' +
        'Rivian,Dion,yes,"Done; pilot 200 tests, annual 400 plus 50"\n',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].client, 'Rivian');
    assert.equal(rows[0].has_se_handoff, 'yes');
    assert.equal(rows[0].notes, 'Done; pilot 200 tests, annual 400 plus 50');
  });

  test('handles empty fields and escaped quotes', () => {
    const rows = parseCsv('client,se_reply,notes\nICANN,,\nKai,,"he said ""done"""\n');
    assert.equal(rows[0].se_reply, '');
    assert.equal(rows[1].notes, 'he said "done"');
  });
});

describe('matchOpportunity', () => {
  const rows = [
    opp('1', 'Bilt - Revival'),
    opp('2', 'Gravitate'),
    opp('3', 'Archer'),
    opp('4', 'Revival - Archera'),
    opp('5', 'International Scripture Ministries, Inc. (ISM)-'),
  ];

  test('matches when the log abbreviates the Salesforce name', () => {
    const m = matchOpportunity('Bilt', rows);
    assert.equal(m.status, 'matched');
    assert.equal(m.row.opportunityId, '1');
  });

  test('matches when the log is more specific than Salesforce', () => {
    const m = matchOpportunity('Gravitate Energy', rows);
    assert.equal(m.status, 'matched');
    assert.equal(m.row.opportunityId, '2');
  });

  test('ignores punctuation and case differences', () => {
    assert.equal(matchOpportunity('ism', rows).row.opportunityId, '5');
  });

  test('reports ambiguity instead of picking one', () => {
    // "Archer" is inside both "Archer" and "Revival - Archera". Choosing
    // either would credit a deal that may not be the one that was handed off.
    const m = matchOpportunity('Archer', rows);
    assert.equal(m.status, 'ambiguous');
    assert.equal(m.rows.length, 2);
  });

  test('reports a name that is in no opportunity', () => {
    assert.equal(matchOpportunity('SignaPay', rows).status, 'missing');
  });

  test('an empty client name is missing, never a match', () => {
    assert.equal(matchOpportunity('', rows).status, 'missing');
    assert.equal(matchOpportunity('   ', rows).status, 'missing');
  });
});

describe('resolveCredit', () => {
  test('credits a replier who handed off', () => {
    const c = resolveCredit({ se_reply: 'Becca', has_se_handoff: 'yes' }, byFirst);
    assert.equal(c.kind, 'credit');
    assert.equal(c.se.id, 'se-becca');
  });

  test('a name without a handoff is NOT a credit', () => {
    // ServiceTitan: the SE posted congratulations, not a handoff. Crediting
    // it would move $421k to the wrong person.
    assert.equal(resolveCredit({ se_reply: 'Jun', has_se_handoff: 'no' }, byFirst).kind, 'none');
  });

  test('no replier is no credit', () => {
    assert.equal(resolveCredit({ se_reply: '', has_se_handoff: 'no' }, byFirst).kind, 'none');
  });

  test('a replier who is not an active SE is flagged, not credited', () => {
    const c = resolveCredit({ se_reply: 'Lauren Wurscher', has_se_handoff: 'yes' }, byFirst);
    assert.equal(c.kind, 'notAnSe');
    assert.equal(c.replier, 'Lauren Wurscher');
  });

  test('matches on first name so surnames in the log still resolve', () => {
    assert.equal(
      resolveCredit({ se_reply: 'Dion Pham', has_se_handoff: 'yes' }, byFirst).se.id,
      'se-dion',
    );
  });
});

describe('resolveHandoffLog', () => {
  const rows = [opp('1', 'Signant Health'), opp('2', 'Teamworks'), opp('3', 'ServiceTitan-')];

  test('collapses several log rows pointing at one opportunity', () => {
    // Four self-managed Teamworks posts resolve to the single Teamworks opp.
    const entries = [
      { client: 'Teamworks GM (Self-Managed)', se_reply: '', has_se_handoff: 'no' },
      { client: 'Teamworks PFF', se_reply: '', has_se_handoff: 'no' },
    ];
    const { desired } = resolveHandoffLog(entries, rows, SES);
    assert.equal(desired.size, 1);
    assert.equal(desired.get('2').seId, null);
  });

  test('separates credits, non-SEs and unmatched names', () => {
    const entries = [
      { client: 'Signant Health', se_reply: 'Becca', has_se_handoff: 'yes' },
      { client: 'ServiceTitan', se_reply: '', has_se_handoff: 'no' },
      { client: 'GoFormz', se_reply: 'Lauren Wurscher', has_se_handoff: 'yes' },
    ];
    const { desired, notSes, missing } = resolveHandoffLog(entries, rows, SES);
    assert.equal(desired.get('1').seId, 'se-becca');
    assert.equal(desired.get('3').seId, null);
    assert.deepEqual(
      notSes.map((n) => n.replier),
      ['Lauren Wurscher'],
    );
    assert.deepEqual(
      missing.map((m) => m.client),
      ['GoFormz'],
    );
  });
});

describe('planWrites', () => {
  test('splits adds, reassignments and revocations', () => {
    const reportRows = [
      { ...opp('1', 'A'), salesEngineerId: null },
      { ...opp('2', 'B'), salesEngineerId: 'se-dion' },
      { ...opp('3', 'C'), salesEngineerId: 'se-becca' },
      { ...opp('4', 'D'), salesEngineerId: 'se-becca' },
    ];
    const desired = new Map([
      ['1', { seId: 'se-becca', row: reportRows[0], client: 'A' }],
      ['2', { seId: 'se-seb', row: reportRows[1], client: 'B' }],
      ['3', { seId: null, row: reportRows[2], client: 'C' }],
      ['4', { seId: 'se-becca', row: reportRows[3], client: 'D' }],
    ]);
    const { adds, changes, removes, unchanged } = planWrites(desired, reportRows);
    assert.deepEqual(
      adds.map((d) => d.client),
      ['A'],
    );
    assert.deepEqual(
      changes.map((d) => d.client),
      ['B'],
    );
    assert.deepEqual(
      removes.map((d) => d.client),
      ['C'],
    );
    assert.deepEqual(
      unchanged.map((d) => d.client),
      ['D'],
    );
  });

  test('re-running an already-seeded database plans no writes', () => {
    const reportRows = [{ ...opp('1', 'A'), salesEngineerId: 'se-becca' }];
    const desired = new Map([['1', { seId: 'se-becca', row: reportRows[0], client: 'A' }]]);
    const { adds, changes, removes } = planWrites(desired, reportRows);
    assert.equal(adds.length + changes.length + removes.length, 0);
  });
});

describe('normalizeName', () => {
  test('strips everything but alphanumerics', () => {
    assert.equal(normalizeName('Phil, Inc - Revival'), 'philincrevival');
    assert.equal(normalizeName('ziosk.com-'), 'zioskcom');
    assert.equal(normalizeName(null), '');
  });
});
