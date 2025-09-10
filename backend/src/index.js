import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import serveStatic from 'serve-static';

// Load env from backend .env, then repo root .env, then default cwd
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

const PORT = process.env.PORT || 7071;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
import { PRIMARY_SYSTEM, PRIMARY_USER_PREFIX, POST_PROCESSOR } from './prompts.js';
import {
  splitArtifacts,
  validateArtifacts,
  callOpenAI,
  extractCsv,
  validateCsvHeader,
} from './helpers.js';
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files from the frontend build directory
const frontendDistPath = resolve(__dirname, '../../frontend/dist');
console.log('Frontend dist path:', frontendDistPath);

// Only serve static files if the dist directory exists
try {
  app.use(serveStatic(frontendDistPath));
  console.log('Static file serving enabled');
} catch (error) {
  console.warn('Static file serving disabled:', error.message);
}

// ---- tiny logger (dev-friendly) ----
app.use((req, _res, next) => {
  const { method, url } = req;
  console.log(`${new Date().toISOString()} ${method} ${url}`);
  next();
});

// ---- health & hello ----
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    env: {
      model: process.env.OPENAI_MODEL || null,
      hasApiKey: Boolean(process.env.OPENAI_API_KEY), // false is OK for now
    },
  });
});

app.get('/', (_req, res) => {
  console.log('✨ @qawolf/ratio-estimator is up');
  res.send('✨ @qawolf/ratio-estimator is up');
});

// ---- stubs for your future endpoints (returning 501 until we wire them) ----
app.post('/estimate/initial', async (req, res) => {
  try {
    const { inputText, model } = req.body || {};
    if (!inputText) return res.status(400).json({ error: 'inputText is required' });

    console.log('Processing CSV with ChatGPT, input preview:', inputText.substring(0, 200) + '...');

    const useModel = model || DEFAULT_MODEL;
    const raw = await callOpenAI({
      openai,
      model: useModel,
      system: PRIMARY_SYSTEM,
      user: PRIMARY_USER_PREFIX + inputText,
    });

    console.log('ChatGPT response received, length:', raw.length);

    const artifacts = splitArtifacts(raw);
    const err = validateArtifacts(artifacts);
    if (err) {
      console.error('Output validation failed:', err);
      return res.status(422).json({ error: `Output validation failed: ${err}`, raw });
    }

    console.log('Successfully processed and validated ChatGPT output');
    res.json(artifacts);
  } catch (e) {
    console.error('Error in /estimate/initial:', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/estimate/postprocess', async (req, res) => {
  try {
    const { csv, text, model } = req.body || {};
    const inputCsv = (csv || extractCsv(text || '')).trim();
    if (!inputCsv)
      return res.status(400).json({ error: 'csv (or text containing ```csv fence) is required' });

    // Optional: validate incoming header to give fast feedback
    const incomingHeaderError = validateCsvHeader(inputCsv);
    if (incomingHeaderError) {
      return res.status(422).json({ error: `Input CSV header invalid: ${incomingHeaderError}` });
    }

    const useModel = model || DEFAULT_MODEL;
    const raw = await callOpenAI({
      openai,
      model: useModel,
      system: POST_PROCESSOR,
      user: inputCsv,
    });

    // Model should return CSV only; tolerate fenced blocks just in case
    const outCsv = extractCsv(raw);
    const headerErr = validateCsvHeader(outCsv);
    if (headerErr)
      return res.status(422).json({ error: `Output validation failed: ${headerErr}`, raw });

    res.json({ csv: outCsv });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/estimate/fix-rejections', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet. This will fix rejected rows.' });
});

// Catch-all handler: send back React's index.html file for any non-API routes
// Note: During development, the frontend dev server handles routing, so this is mainly for production
app.get(/^(?!\/api).*/, (req, res) => {
  const indexPath = resolve(__dirname, '../../frontend/dist/index.html');
  console.log('Serving index.html from:', indexPath);

  try {
    res.sendFile(indexPath);
  } catch (error) {
    console.error('Error serving index.html:', error.message);
    res.status(404).send('Frontend not built. Please run npm run build first.');
  }
});

// ---- start server ----
app.listen(PORT, () => {
  console.log(`[ratio-estimator] listening on :${PORT}`);
});
