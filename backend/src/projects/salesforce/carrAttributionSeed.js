/**
 * Turns the SE handoff log into CARR attributions.
 *
 * The stored attributions are derived data: every one of them comes from
 * `backend/data/attributions/se-handoffs.csv` (who handed off which client)
 * resolved against the live "All Closed Won" report (which opportunity that
 * client is). Keeping the derivation in code rather than dumping the table is
 * what makes this portable between environments -- a dump would carry local
 * `salesEngineerId` cuids, which don't exist in any other database.
 *
 * Everything here is pure. The database and Salesforce live in the seed
 * script that calls it, so the matching rules can be tested directly.
 */

/** Fold a company name to comparable form: lowercase, alphanumerics only. */
export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Minimal RFC-4180 parser. The notes column carries commas and quoted
 * strings ("Done; pilot 200 primary web tests, annual 400..."), so splitting
 * on commas silently corrupts every row after it.
 */
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else field += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      record.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      if (record.some((c) => c !== '')) rows.push(record);
      record = [];
      field = '';
      continue;
    }
    field += char;
  }
  record.push(field);
  if (record.some((c) => c !== '')) rows.push(record);

  const header = rows.shift() || [];
  return rows.map((cells) =>
    Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()])),
  );
}

/**
 * Find the one report row a CSV `client` refers to.
 *
 * Matching is bidirectional containment on the normalized names because the
 * log and Salesforce disagree in both directions: the log abbreviates
 * ("Bilt" for "Bilt - Revival") and occasionally over-specifies
 * ("Gravitate Energy" for "Gravitate").
 *
 * More than one candidate is an ambiguity, never a coin flip -- "Archer"
 * matches both `Archer` and `Revival - Archera`, and picking either would
 * silently credit real revenue against the wrong deal. The caller reports it.
 *
 * @returns {{ status:'matched', row:object } | { status:'ambiguous', rows:object[] } | { status:'missing' }}
 */
export function matchOpportunity(client, rows) {
  const needle = normalizeName(client);
  if (!needle) return { status: 'missing' };

  const candidates = rows.filter((row) => {
    const hay = normalizeName(row.opportunityName);
    return hay.includes(needle) || needle.includes(hay);
  });

  if (candidates.length === 1) return { status: 'matched', row: candidates[0] };
  if (candidates.length > 1) return { status: 'ambiguous', rows: candidates };
  return { status: 'missing' };
}

/**
 * Who a handoff row credits.
 *
 * `se_reply` and `has_se_handoff` must BOTH be affirmative. A name attached
 * to `has_se_handoff=no` is explicitly not a credit -- ServiceTitan is the
 * worked example, where the SE posted a congratulations message rather than
 * a handoff, and crediting it would move $421k to the wrong person.
 *
 * A named replier who is not an active SE in the app resolves to `notAnSe`
 * rather than an error: Lauren Wurscher and Amanda Morrow appear throughout
 * the 2024 log and have no SalesEngineer record to point at.
 *
 * @param {{ se_reply?:string, has_se_handoff?:string }} entry
 * @param {Map<string, object>} sesByFirstName lowercase first name -> SE
 */
export function resolveCredit(entry, sesByFirstName) {
  const replier = (entry.se_reply || '').trim();
  const handedOff = (entry.has_se_handoff || '').trim().toLowerCase() === 'yes';

  if (!replier || !handedOff) return { kind: 'none' };

  const firstName = replier.split(/\s+/)[0].toLowerCase();
  const se = sesByFirstName.get(firstName);
  if (!se) return { kind: 'notAnSe', replier };
  return { kind: 'credit', se };
}

/**
 * Resolve the whole log against the report and the SE roster.
 *
 * Returns the desired end state plus everything that couldn't be resolved, so
 * a caller can print a full account before touching the database. Rows are
 * keyed by opportunity id, so several log lines pointing at one opportunity
 * (the four self-managed Teamworks posts) collapse to a single decision.
 *
 * @param {object[]} entries parsed CSV rows
 * @param {object[]} reportRows rows from getCarrBySePayload()
 * @param {object[]} salesEngineers active SEs, each with `name`
 */
export function resolveHandoffLog(entries, reportRows, salesEngineers) {
  const sesByFirstName = new Map(
    salesEngineers.map((se) => [se.name.split(/\s+/)[0].toLowerCase(), se]),
  );

  const desired = new Map(); // opportunityId -> { seId, row, client }
  const ambiguous = [];
  const missing = [];
  const notSes = [];

  for (const entry of entries) {
    const credit = resolveCredit(entry, sesByFirstName);
    if (credit.kind === 'notAnSe') notSes.push({ client: entry.client, replier: credit.replier });

    const match = matchOpportunity(entry.client, reportRows);
    if (match.status === 'ambiguous') {
      ambiguous.push({ client: entry.client, candidates: match.rows });
      continue;
    }
    if (match.status === 'missing') {
      missing.push({
        client: entry.client,
        wanted: credit.kind === 'credit' ? credit.se.name : null,
      });
      continue;
    }

    desired.set(match.row.opportunityId, {
      seId: credit.kind === 'credit' ? credit.se.id : null,
      row: match.row,
      client: entry.client,
    });
  }

  return { desired, ambiguous, missing, notSes };
}

/**
 * Diff the desired state against what the report rows already carry.
 * Splitting adds from revocations matters: a revocation removes CARR from
 * someone's total, which is the change most worth seeing before it runs.
 */
export function planWrites(desired, reportRows) {
  const current = new Map(
    reportRows.filter((r) => r.salesEngineerId).map((r) => [r.opportunityId, r.salesEngineerId]),
  );

  const adds = [];
  const changes = [];
  const removes = [];
  const unchanged = [];

  for (const [opportunityId, want] of desired) {
    const from = current.get(opportunityId) ?? null;
    if (from === want.seId) {
      unchanged.push(want);
      continue;
    }
    if (want.seId && !from) adds.push({ ...want, from });
    else if (want.seId) changes.push({ ...want, from });
    else removes.push({ ...want, from });
  }

  return { adds, changes, removes, unchanged };
}
