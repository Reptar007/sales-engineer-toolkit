/**
 * Tiny, dependency-free HTML-entity decoder. Used to clean up text we
 * receive from upstream sources (Gong call summaries, occasionally
 * Salesforce long-text fields) where apostrophes / quotes / ampersands
 * arrive as numeric or named entity references and would otherwise leak
 * into the UI and Notion handoff pages as literal "&#39;" / "&amp;".
 *
 * We intentionally do NOT use a full HTML parser -- the inputs aren't
 * HTML documents, they're plain-text fields that happen to have entity-
 * escaped punctuation. A targeted decode keeps the surface area small
 * and avoids accidentally stripping or transforming other content.
 */

// Named entities we actually see in production payloads. Add more here
// as they show up; everything else falls through unchanged.
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
};

export function decodeHtmlEntities(input) {
  if (input == null) return input;
  if (typeof input !== 'string') return input;
  if (!input.includes('&')) return input;

  return (
    input
      // Numeric decimal: &#39;
      .replace(/&#(\d+);/g, (_, dec) => {
        const code = parseInt(dec, 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _;
        try {
          return String.fromCodePoint(code);
        } catch {
          return _;
        }
      })
      // Numeric hex: &#x27;
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const code = parseInt(hex, 16);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return _;
        try {
          return String.fromCodePoint(code);
        } catch {
          return _;
        }
      })
      // Named entities: &amp; &quot; etc.
      .replace(/&([a-zA-Z]+);/g, (match, name) => {
        const decoded = NAMED_ENTITIES[name.toLowerCase()];
        return decoded == null ? match : decoded;
      })
  );
}
