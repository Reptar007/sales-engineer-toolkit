import express from 'express';
import { anthropicService } from '../../../services/anthropicService.js';

const router = express.Router();

/**
 * Parse a QA Wolf app URL into environmentId, relativePath, and the API base URL.
 * Expected format:
 *   https://app.qawolf.com/<org>/environments/<ENV_ID>/automate/ide?file=src%2Fflows%2Fsome-flow.flow.js
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

  if (!relativePath) {
    throw new Error(
      'Could not extract file path from URL. Make sure the URL contains a ?file= query parameter.',
    );
  }

  // Derive tRPC base from the URL origin so prod and staging URLs both work
  const trpcBase = `${parsed.origin}/api/trpc`;
  // org slug is the first non-empty path segment: /foreflight-demo/environments/...
  const orgSlug = segments.find((s) => s && s !== 'environments') || '';

  return { environmentId, relativePath, trpcBase, orgSlug };
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

  const authHeader = { Authorization: `Bearer ${qawBearerToken}` };

  // 2. Fetch branchId (gitWolfBranchId) and commitHash via gitwolf.getFiles
  let gitWolfBranchId, commitHash;
  try {
    const filesUrl = `${trpcBase}/gitwolf.getFiles?input=${encodeURIComponent(JSON.stringify({ json: { environmentId } }))}`;
    const filesRes = await fetch(filesUrl, { headers: authHeader });
    const rawText = await filesRes.text();

    if (!filesRes.ok) {
      throw new Error(`QA Wolf API returned ${filesRes.status}: ${rawText.slice(0, 300)}`);
    }

    const filesData = JSON.parse(rawText);
    const data = filesData?.result?.data?.json ?? filesData?.result?.data ?? filesData;
    gitWolfBranchId = data?.branch?.id;
    commitHash = data?.commitHash;

    if (!gitWolfBranchId || !commitHash) {
      throw new Error(
        `Could not extract branch/commit info. Got keys: ${Object.keys(data || {}).join(', ')}`,
      );
    }
  } catch (err) {
    console.error('Error fetching environment files:', err);
    return res.status(502).json({ error: `Failed to fetch environment info: ${err.message}` });
  }

  // 3. Fetch raw file contents
  let fileSource;
  try {
    const contentsUrl = `${trpcBase}/gitwolf.getFileContents?input=${encodeURIComponent(JSON.stringify({ json: { branchId: gitWolfBranchId, commitHash, path: relativePath } }))}`;
    const contentsRes = await fetch(contentsUrl, { headers: authHeader });
    const rawText = await contentsRes.text();

    if (!contentsRes.ok) {
      throw new Error(`QA Wolf API returned ${contentsRes.status}: ${rawText.slice(0, 300)}`);
    }

    const contentsData = JSON.parse(rawText);
    const data = contentsData?.result?.data?.json ?? contentsData?.result?.data ?? contentsData;
    fileSource = data?.content;

    if (typeof fileSource !== 'string') {
      throw new Error(`Unexpected response shape. Got keys: ${Object.keys(data || {}).join(', ')}`);
    }
  } catch (err) {
    console.error('Error fetching file contents:', err);
    return res.status(502).json({ error: `Failed to fetch flow file: ${err.message}` });
  }

  // 4. Extract test steps
  const steps = extractTestSteps(fileSource);

  // 5. Generate AI summary via Anthropic
  let summary;
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

    summary = await anthropicService.callAnthropic(systemPrompt, userPrompt);

    // Hard-enforce 2 sentences: split on ". " or "." followed by capital or end-of-string
    // Use a positive lookahead so we split after the period, not before the next word
    const sentenceParts = summary.split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sentenceParts.length > 2) {
      summary = sentenceParts.slice(0, 2).join(' ').trim();
    }
  } catch (err) {
    console.error('Error generating summary:', err);
    // Non-fatal: return a placeholder so the doc is still useful
    summary = 'AI summary unavailable. Please review the flow steps below.';
  }

  const flowName = flowNameFromPath(relativePath);
  const orgName = orgNameFromSlug(orgSlug);
  const docTitle = orgName ? `${orgName} - ${flowName}` : flowName;

  return res.json({
    success: true,
    flowName: docTitle,
    filePath: relativePath,
    summary,
    steps,
  });
});

// Route info
router.get('/', (_req, res) => {
  res.json({
    project: 'Flow Doc Generator',
    description: 'Generate technical leave-behind documents from QA Wolf flow URLs',
    version: '1.0.0',
    endpoints: {
      generate: 'POST /api/flow-doc/generate',
    },
  });
});

export default router;
