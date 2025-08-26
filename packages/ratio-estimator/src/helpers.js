// packages/ratio-estimator/src/helpers.js

// Exact header your pipeline expects
export const CSV_HEADER = 'Feature,Test Case Name,QAW Estimated test,Notes';

// Find the ```csv ... ``` fenced block and return { table, csv }
export function splitArtifacts(text = '') {
  const m = text.match(/```csv\s*([\s\S]*?)```/i);
  const csv = m ? m[1].trim() : '';
  const table = (m ? text.replace(m[0], '') : text).trim();
  return { table, csv };
}

// Minimal validation to keep the pipeline deterministic
export function validateArtifacts({ table, csv }) {
  if (!table || !csv) return 'Expected a markdown table followed by a ```csv``` code block.';

  // CSV header must match (accept quoted or unquoted cells, ignore spacing)
  const headerLine = (csv.split(/\r?\n/)[0] || '').trim();
  const splitCsvCells = (line) => {
    // Split on commas not enclosed in double quotes
    const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    return parts.map((p) => {
      let cell = p.trim();
      if (cell.startsWith('"') && cell.endsWith('"')) {
        cell = cell.slice(1, -1).replace(/""/g, '"');
      }
      return cell.trim();
    });
  };
  const expected = ['Feature', 'Test Case Name', 'QAW Estimated test', 'Notes'].map((s) =>
    s.toLowerCase(),
  );
  const actual = splitCsvCells(headerLine).map((s) => s.toLowerCase());
  const headerMatches =
    actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  if (!headerMatches) return `CSV header must be exactly: ${CSV_HEADER}`;

  // Table must be GitHub-style and include the 4 columns in order at the header row
  const tableHeaderLine = (
    table.split('\n').find((l) => l.trim().startsWith('|')) || ''
  ).toLowerCase();
  const cols = ['feature', 'test case name', 'qaw estimated test', 'notes'];
  const ok = cols.every((c, i) => tableHeaderLine.includes(cols[i]));
  if (!ok)
    return 'Markdown table must have columns: Feature | Test Case Name | QAW Estimated test | Notes';

  return null; // valid
}

// Thin wrapper around OpenAI Chat Completions (omit temperature for models that only support defaults)
export async function callOpenAI({ openai, model, system, user }) {
  const r = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return (r.choices?.[0]?.message?.content || '').trim();
}
