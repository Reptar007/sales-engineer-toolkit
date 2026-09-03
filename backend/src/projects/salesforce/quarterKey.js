/**
 * Quarter-label parsing for the Salesforce metrics report.
 *
 * The report groups closed-won rows by fiscal quarter and emits labels like
 * "Q2 CY2026". That parse used to exist in four places with four different
 * regexes -- two of them strictly anchored (`/^Q(\d) CY(\d+)$/`) and one
 * lenient -- so a whitespace change in the Salesforce label would have broken
 * some call sites and left others working. Everything goes through here now.
 */

// Deliberately lenient: tolerates "Q2 CY2026", "Q2 2026", "Q2CY2026" and
// surrounding text, because the label is Salesforce's to change, not ours.
const QUARTER_LABEL = /Q([1-4])\s*(?:CY)?\s*(\d{4})/i;

/**
 * @param {string} label e.g. "Q2 CY2026"
 * @returns {{ year: number, quarter: number } | null} null when unparseable
 */
export function parseQuarterKey(label) {
  if (typeof label !== 'string') return null;
  const match = QUARTER_LABEL.exec(label.trim());
  if (!match) return null;
  return {
    quarter: Number.parseInt(match[1], 10),
    year: Number.parseInt(match[2], 10),
  };
}

/**
 * Render a period back into the report's own label form.
 * @param {{ year: number, quarter: number }} period
 */
export function formatQuarterKey({ year, quarter }) {
  return `Q${quarter} CY${year}`;
}

/**
 * Sortable ordinal for a quarter label, so quarters order correctly across a
 * year boundary. Returns -1 for unparseable labels (they sort first).
 */
export function quarterOrdinal(label) {
  const period = parseQuarterKey(label);
  return period ? period.year * 4 + period.quarter : -1;
}

/** The previous quarter, wrapping across the year boundary. */
export function previousQuarter({ year, quarter }) {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}
