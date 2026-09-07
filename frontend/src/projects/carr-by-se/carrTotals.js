/**
 * The one place CARR-by-SE totals are derived.
 *
 * The cards and the table read the same `rows` array through this module, so
 * a card can never disagree with the rows beneath it -- the same reasoning
 * behind the backend's goalEligibility.js, where six call sites re-deriving
 * "does this count?" had already drifted apart.
 *
 * Unattributed rows (`salesEngineerId: null`) are counted in `totalCarr` so
 * the page can show how much history is still unassigned, but never in
 * `attributedCarr`, which is what the SE cards sum to. The "Attributed" card
 * is therefore always exactly the sum of the per-SE cards beside it.
 */

/** Currency, matching the backend's `usd()` in metricsPayload.js. */
export function formatCurrency(amount) {
  return `$${Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact form for card headlines, where two decimals are noise. */
export function formatCurrencyCompact(amount) {
  const value = Number(amount || 0);
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * Roll a set of rows into the totals the cards render.
 *
 * @param {object[]} rows rows as returned by GET /api/salesforce/carr-by-se
 * @param {{id:string,name:string}[]} salesEngineers picker options
 * @returns {{
 *   totalCarr:number, attributedCarr:number, unattributedCarr:number,
 *   oppCount:number, attributedCount:number, unattributedCount:number,
 *   bySe:{id:string,name:string,carr:number,count:number}[]
 * }} `bySe` covers every SE, including those with nothing attributed, so the
 *   card row doesn't reflow as assignments are made.
 */
export function summarizeRows(rows = [], salesEngineers = []) {
  const carrBySe = new Map();
  const countBySe = new Map();

  let totalCarr = 0;
  let attributedCarr = 0;
  let attributedCount = 0;

  for (const row of rows) {
    const amount = Number(row.carrAmount) || 0;
    totalCarr += amount;

    const seId = row.salesEngineerId;
    if (!seId) continue;

    attributedCarr += amount;
    attributedCount += 1;
    carrBySe.set(seId, (carrBySe.get(seId) || 0) + amount);
    countBySe.set(seId, (countBySe.get(seId) || 0) + 1);
  }

  const bySe = salesEngineers
    .map((se) => ({
      id: se.id,
      name: se.name,
      carr: carrBySe.get(se.id) || 0,
      count: countBySe.get(se.id) || 0,
    }))
    .sort((a, b) => b.carr - a.carr || a.name.localeCompare(b.name));

  return {
    totalCarr,
    attributedCarr,
    unattributedCarr: totalCarr - attributedCarr,
    oppCount: rows.length,
    attributedCount,
    unattributedCount: rows.length - attributedCount,
    bySe,
  };
}

/**
 * Per-year summaries keyed by fiscal year, for the all-time strip's sparkline
 * of "how much of each year is still unassigned".
 *
 * @param {object[]} rows
 * @param {string[]} years
 * @param {{id:string,name:string}[]} salesEngineers
 */
export function summarizeByYear(rows = [], years = [], salesEngineers = []) {
  const byYear = {};
  for (const year of years) {
    byYear[year] = summarizeRows(
      rows.filter((row) => row.fiscalYear === year),
      salesEngineers,
    );
  }
  return byYear;
}
