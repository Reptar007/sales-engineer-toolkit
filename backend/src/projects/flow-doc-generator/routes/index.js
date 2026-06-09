import express from 'express';
import { anthropicService } from '../../../services/anthropicService.js';

const router = express.Router();

/**
 * Parse a QA Wolf app URL into environmentId, relativePath, and the API base URL.
 *
 * Supports two shapes:
 *   Single flow URL (has a ?file= param):
 *     https://app.qawolf.com/<org>/environments/<ENV_ID>/automate/ide?file=src%2Fflows%2Fsome-flow.flow.js
 *   Environment URL (no ?file= param), used for bulk generation:
 *     https://app.qawolf.com/<org>/environments/<ENV_ID>/automate/ide
 *
 * `relativePath` is `null` when no ?file= param is present so callers can decide
 * whether a file is required (single) or optional (bulk).
 *
 * The tRPC base URL is derived from the pasted URL's origin so prod/staging URLs
 * always hit the correct host regardless of the QAW_BASE_URL env var.
 */
function parseQawolfUrl(flowUrl) {
  let parsed;
  try {
    parsed = new URL(flowUrl);
  } catch {
    throw new Error('Invalid URL provided.');
  }

  const segments = parsed.pathname.split('/');
  const envIndex = segments.indexOf('environments');
  if (envIndex === -1 || !segments[envIndex + 1]) {
    throw new Error(
      'Could not extract environment ID from URL. Make sure the URL contains /environments/<ENV_ID>/.',
    );
  }

  const environmentId = segments[envIndex + 1];
  const relativePath = parsed.searchParams.get('file');

  // Derive tRPC base from the URL origin so prod and staging URLs both work
  const trpcBase = `${parsed.origin}/api/trpc`;
  // org slug is the first non-empty path segment: /foreflight-demo/environments/...
  const orgSlug = segments.find((s) => s && s !== 'environments') || '';

  return { environmentId, relativePath, trpcBase, orgSlug };
}

/**
 * Friendly error message for upstream QA Wolf 401 responses. Both gitwolf
 * fetches use the same bearer token, so an auth failure on either step
 * means the same fix is needed and we surface the same actionable message
 * to the user.
 */
const QAW_INVALID_TOKEN_MESSAGE =
  'QA Wolf access token is invalid or expired. Please reach out to an admin to update the QA Wolf Bearer token.';

/**
 * Custom error tag used to bubble a QA Wolf auth failure up to the route
 * handler so we can return a 401 (instead of the generic 502 we use for
 * other upstream failures) without resorting to message-string sniffing.
 */
class QawAuthError extends Error {
  constructor(message = QAW_INVALID_TOKEN_MESSAGE) {
    super(message);
    this.name = 'QawAuthError';
  }
}

/**
 * Derive a human-readable flow name from its file path.
 * e.g. "src/flows/login-happy-path.flow.js" => "Login Happy Path"
 */
function flowNameFromPath(filePath) {
  const basename = filePath.split('/').pop() || filePath;
  return basename
    .replace(/\.flow\.(js|ts)$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Derive a human-readable org/opp name from the URL slug.
 * e.g. "foreflight-demo" => "ForeFlight"
 */
function orgNameFromSlug(slug) {
  return slug
    .replace(/[-_](demo|sandbox)$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract individual `await test(...)` blocks from flow source code.
 * Falls back to treating the whole file as one unnamed step if none found.
 */
function extractTestSteps(source) {
  const steps = [];
  // Match: await test("name", async () => { ... }) - handles nested braces
  const regex = /await\s+test\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*async\s*\(\s*\)\s*=>\s*\{/g;

  let match;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1];
    if (name === 'Node 20 Helpers') continue;

    const blockStart = match.index + match[0].length - 1; // position of opening '{'
    let depth = 1;
    let i = blockStart + 1;

    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }

    // Full block including `await test(...)` wrapper
    const fullBlock = source.slice(match.index, i);
    steps.push({ name, code: fullBlock.trim() });
  }

  if (steps.length === 0) {
    steps.push({ name: 'Full Flow', code: source.trim() });
  }

  return steps;
}

/**
 * Recursively collect every string leaf in an arbitrary JSON structure.
 * The gitwolf.getFiles response shape is not guaranteed, so we walk it
 * defensively and pull out anything that looks like a file path.
 */
function collectAllStrings(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectAllStrings(item, out);
  } else if (typeof node === 'object') {
    for (const value of Object.values(node)) collectAllStrings(value, out);
  }
  return out;
}

/**
 * Walk the gitwolf.getFiles response and collect every flow file path
 * (`*.flow.js` / `*.flow.ts`), regardless of the tree's exact shape.
 */
function enumerateFlowFiles(filesData) {
  const strings = collectAllStrings(filesData);
  const flows = new Set();
  for (const s of strings) {
    if (/\.flow\.(js|ts)$/.test(s)) flows.add(s);
  }
  return [...flows].sort();
}

/**
 * Fetch raw contents for a single file via gitwolf.getFileContents.
 * Throws QawAuthError on 401/403 so callers can surface a 401.
 */
async function fetchFileContents({ trpcBase, authHeader, branchId, commitHash, filePath }) {
  const contentsUrl = `${trpcBase}/gitwolf.getFileContents?input=${encodeURIComponent(
    JSON.stringify({ json: { branchId, commitHash, path: filePath } }),
  )}`;
  const contentsRes = await fetch(contentsUrl, { headers: authHeader });
  const rawText = await contentsRes.text();

  if (contentsRes.status === 401 || contentsRes.status === 403) {
    throw new QawAuthError();
  }

  if (!contentsRes.ok) {
    throw new Error(`QA Wolf API returned ${contentsRes.status}: ${rawText.slice(0, 300)}`);
  }

  const contentsData = JSON.parse(rawText);
  const data = contentsData?.result?.data?.json ?? contentsData?.result?.data ?? contentsData;
  const fileSource = data?.content;

  if (typeof fileSource !== 'string') {
    throw new Error(`Unexpected response shape. Got keys: ${Object.keys(data || {}).join(', ')}`);
  }

  return fileSource;
}

/**
 * Resolve the git branch/commit context for an environment and return the raw
 * files payload so callers can also enumerate flows.
 * Throws QawAuthError on 401/403.
 */
async function fetchGitContext({ trpcBase, authHeader, environmentId }) {
  const filesUrl = `${trpcBase}/gitwolf.getFiles?input=${encodeURIComponent(
    JSON.stringify({ json: { environmentId } }),
  )}`;
  const filesRes = await fetch(filesUrl, { headers: authHeader });
  const rawText = await filesRes.text();

  if (filesRes.status === 401 || filesRes.status === 403) {
    throw new QawAuthError();
  }

  if (!filesRes.ok) {
    throw new Error(`QA Wolf API returned ${filesRes.status}: ${rawText.slice(0, 300)}`);
  }

  const filesData = JSON.parse(rawText);
  const data = filesData?.result?.data?.json ?? filesData?.result?.data ?? filesData;
  const branchId = data?.branch?.id;
  const commitHash = data?.commitHash;

  if (!branchId || !commitHash) {
    throw new Error(
      `Could not extract branch/commit info. Got keys: ${Object.keys(data || {}).join(', ')}`,
    );
  }

  return { branchId, commitHash, filesData: data };
}

/**
 * Generate an AI summary of a flow.
 * Non-fatal: returns a placeholder string if the AI call fails.
 */
async function summarizeFlow({ relativePath, fileSource }) {
  try {
    const systemPrompt =
      'You are a senior QA engineer writing professional technical documentation for a sales leave-behind document. ' +
      'Your response must be exactly 2 - 4 sentences, no more. ' +
      'Never use em dashes. Use plain punctuation only.';

    const userPrompt =
      `Summarize what the following QA Wolf automated test flow verifies end-to-end in exactly 2 - 4 sentences. ` +
      `Be specific about the features and user actions covered. Stop after the second sentence.\n\n` +
      `Flow file path: ${relativePath}\n\n` +
      `Flow source code:\n${fileSource}`;

    let summary = await anthropicService.callAnthropic(systemPrompt, userPrompt);

    // Hard-enforce 2 sentences: split after a sentence-ending punctuation
    // followed by a capital letter.
    const sentenceParts = summary.split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sentenceParts.length > 2) {
      summary = sentenceParts.slice(0, 2).join(' ').trim();
    }
    return summary;
  } catch (err) {
    console.error('Error generating summary:', err);
    return 'AI summary unavailable. Please review the flow steps below.';
  }
}

/**
 * Build a full flow doc (title, summary, steps) for a single flow file.
 * Reused by both the single-flow and bulk endpoints. Expects the caller to have
 * already resolved the git context (branchId/commitHash).
 *
 * Throws QawAuthError if fetching the flow file fails auth (so the route
 * can return 401).
 */
async function generateFlowDoc({
  trpcBase,
  authHeader,
  branchId,
  commitHash,
  relativePath,
  orgSlug,
}) {
  // 1. Fetch the flow file
  const fileSource = await fetchFileContents({
    trpcBase,
    authHeader,
    branchId,
    commitHash,
    filePath: relativePath,
  });

  // 2. Extract test steps
  const steps = extractTestSteps(fileSource);

  // 3. AI summary
  const summary = await summarizeFlow({ relativePath, fileSource });

  const flowName = flowNameFromPath(relativePath);
  const orgName = orgNameFromSlug(orgSlug);
  const docTitle = orgName ? `${orgName} - ${flowName}` : flowName;

  return {
    flowName: docTitle,
    filePath: relativePath,
    summary,
    steps,
  };
}

/**
 * Run an async mapper over items with a bounded concurrency so bulk generation
 * doesn't fire dozens of Anthropic calls simultaneously and trip rate limits.
 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// POST /api/flow-doc/generate
router.post('/generate', async (req, res) => {
  const { flowUrl } = req.body;

  if (!flowUrl || typeof flowUrl !== 'string') {
    return res.status(400).json({ error: 'flowUrl is required.' });
  }

  // Read token at request time so injected env vars are always picked up
  const qawBearerToken = process.env.QAW_BEARER_TOKEN;
  if (!qawBearerToken) {
    return res.status(500).json({ error: 'QAW_BEARER_TOKEN is not configured on the server.' });
  }

  // 1. Parse URL
  let environmentId, relativePath, trpcBase, orgSlug;
  try {
    ({ environmentId, relativePath, trpcBase, orgSlug } = parseQawolfUrl(flowUrl));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!relativePath) {
    return res.status(400).json({
      error:
        'Could not extract file path from URL. Make sure the URL contains a ?file= query parameter, or use the environment URL for bulk generation.',
    });
  }

  const authHeader = { Authorization: `Bearer ${qawBearerToken}` };

  // 2. Resolve git context (branch/commit)
  let branchId, commitHash;
  try {
    ({ branchId, commitHash } = await fetchGitContext({
      trpcBase,
      authHeader,
      environmentId,
    }));
  } catch (err) {
    console.error('Error fetching environment files:', err);
    if (err instanceof QawAuthError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(502).json({ error: `Failed to fetch environment info: ${err.message}` });
  }

  // 3. Generate the doc
  try {
    const doc = await generateFlowDoc({
      trpcBase,
      authHeader,
      branchId,
      commitHash,
      relativePath,
      orgSlug,
    });
    return res.json({ success: true, ...doc });
  } catch (err) {
    console.error('Error generating flow doc:', err);
    if (err instanceof QawAuthError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(502).json({ error: `Failed to fetch flow file: ${err.message}` });
  }
});

// POST /api/flow-doc/list-flows
// Returns the list of flows in an environment WITHOUT generating any docs, so
// the user can choose which ones to generate.
router.post('/list-flows', async (req, res) => {
  const { environmentUrl } = req.body;

  if (!environmentUrl || typeof environmentUrl !== 'string') {
    return res.status(400).json({ error: 'environmentUrl is required.' });
  }

  const qawBearerToken = process.env.QAW_BEARER_TOKEN;
  if (!qawBearerToken) {
    return res.status(500).json({ error: 'QAW_BEARER_TOKEN is not configured on the server.' });
  }

  let environmentId, trpcBase, orgSlug;
  try {
    ({ environmentId, trpcBase, orgSlug } = parseQawolfUrl(environmentUrl));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const authHeader = { Authorization: `Bearer ${qawBearerToken}` };

  let filesData;
  try {
    ({ filesData } = await fetchGitContext({ trpcBase, authHeader, environmentId }));
  } catch (err) {
    console.error('Error fetching environment files:', err);
    if (err instanceof QawAuthError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(502).json({ error: `Failed to fetch environment info: ${err.message}` });
  }

  const flowPaths = enumerateFlowFiles(filesData);
  if (flowPaths.length === 0) {
    return res.status(404).json({
      error: 'No flow files (*.flow.js) were found in this environment.',
    });
  }

  const flows = flowPaths.map((filePath) => ({
    filePath,
    flowName: flowNameFromPath(filePath),
  }));

  return res.json({
    success: true,
    environmentName: orgNameFromSlug(orgSlug),
    flows,
  });
});

// POST /api/flow-doc/generate-bulk
router.post('/generate-bulk', async (req, res) => {
  const { environmentUrl, filePaths } = req.body;

  if (!environmentUrl || typeof environmentUrl !== 'string') {
    return res.status(400).json({ error: 'environmentUrl is required.' });
  }

  const qawBearerToken = process.env.QAW_BEARER_TOKEN;
  if (!qawBearerToken) {
    return res.status(500).json({ error: 'QAW_BEARER_TOKEN is not configured on the server.' });
  }

  // 1. Parse URL (file param is ignored for bulk)
  let environmentId, trpcBase, orgSlug;
  try {
    ({ environmentId, trpcBase, orgSlug } = parseQawolfUrl(environmentUrl));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const authHeader = { Authorization: `Bearer ${qawBearerToken}` };

  // 2. Resolve git context + file tree
  let branchId, commitHash, filesData;
  try {
    ({ branchId, commitHash, filesData } = await fetchGitContext({
      trpcBase,
      authHeader,
      environmentId,
    }));
  } catch (err) {
    console.error('Error fetching environment files:', err);
    if (err instanceof QawAuthError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(502).json({ error: `Failed to fetch environment info: ${err.message}` });
  }

  // 3. Enumerate flow files
  const flowPaths = enumerateFlowFiles(filesData);
  if (flowPaths.length === 0) {
    return res.status(404).json({
      error: 'No flow files (*.flow.js) were found in this environment.',
    });
  }

  // Restrict to the user-selected flows. If none are provided we fall back to
  // all flows (backwards compatible), but the UI always sends a selection.
  let targetPaths = flowPaths;
  if (Array.isArray(filePaths) && filePaths.length > 0) {
    const allowed = new Set(flowPaths);
    targetPaths = filePaths.filter((p) => allowed.has(p));
    if (targetPaths.length === 0) {
      return res.status(400).json({
        error: 'None of the selected flows were found in this environment.',
      });
    }
  }

  // 4. Generate a doc per flow with bounded concurrency; capture per-flow failures
  const failures = [];
  let authFailed = false;

  const docs = await mapWithConcurrency(targetPaths, 4, async (relativePath) => {
    try {
      return await generateFlowDoc({
        trpcBase,
        authHeader,
        branchId,
        commitHash,
        relativePath,
        orgSlug,
      });
    } catch (err) {
      if (err instanceof QawAuthError) authFailed = true;
      failures.push({ filePath: relativePath, error: err.message });
      return null;
    }
  });

  const successfulDocs = docs.filter(Boolean);

  // If everything failed on auth, surface the actionable 401.
  if (successfulDocs.length === 0 && authFailed) {
    return res.status(401).json({ error: QAW_INVALID_TOKEN_MESSAGE });
  }

  return res.json({
    success: true,
    environmentName: orgNameFromSlug(orgSlug),
    docs: successfulDocs,
    failures,
  });
});

// Route info
router.get('/', (_req, res) => {
  res.json({
    project: 'Flow Doc Generator',
    description: 'Generate technical leave-behind documents from QA Wolf flow URLs',
    version: '2.0.0',
    endpoints: {
      generate: 'POST /api/flow-doc/generate',
      listFlows: 'POST /api/flow-doc/list-flows',
      generateBulk: 'POST /api/flow-doc/generate-bulk',
    },
  });
});

export default router;
