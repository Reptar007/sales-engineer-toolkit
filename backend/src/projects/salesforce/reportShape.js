// Shape detection for the metrics report. The 2026 report inserted an
// "Account Score" column between "Sales Score" and "Effective Date",
// shifting Effective Date / Gross ARR / CARR by one. Earlier years
// (e.g. 2025) still emit the original 6-column layout. Detect by row
// width so live fetches and snapshots both pick the right indices
// without needing to plumb the calendar year all the way down.
//
//   2025 (old, 6 cols):
//     [0] AE  [1] Opp  [2] Sales Score  [3] Effective Date  [4] Gross ARR  [5] CARR
//
//   2026 (new, 7 cols):
//     [0] AE  [1] Opp  [2] Sales Score  [3] Account Score  [4] Effective Date  [5] Gross ARR  [6] CARR

// Returns true when the metrics report includes the Account Score
// column. Probes the first non-empty row's cell count — every row in
// a given report shares the same column layout, so one row is enough.
// Falls back to false (old shape) when the report has no rows at all,
// so an empty year doesn't accidentally promote itself to the new
// layout and start parsing absent fields.
export function detectHasAccountScore(factMap) {
  for (const q of Object.values(factMap || {})) {
    const cells = q?.rows?.[0]?.dataCells;
    if (cells?.length) return cells.length >= 7;
  }
  return false;
}

// Build the per-shape index map used by both parsers. Centralises the
// "where does Effective Date live in this layout" knowledge so the
// two near-identical parser blocks stay in lockstep when columns
// shift again later.
export function getMetricsColumnIndices(hasAccountScore) {
  return {
    aeName: 0,
    opportunityName: 1,
    salesScore: 2,
    accountScore: hasAccountScore ? 3 : -1,
    effectiveDate: hasAccountScore ? 4 : 3,
    grossARR: hasAccountScore ? 5 : 4,
    carr: hasAccountScore ? 6 : 5,
  };
}
