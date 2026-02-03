/**
 * Step 2.2: Key Moment Extraction
 *
 * Loads an embeddings file, compares each turn to query phrases (demo walkthrough,
 * technical explanation, objection handling, etc.) via cosine similarity, and
 * writes turns above a score threshold to data/key-moments/.
 *
 * Usage: node extract_key_moments.js <embeddings_file>
 * Example: node extract_key_moments.js data/embeddings/2026-01-20_disco_demo_embeddings.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { resolve1PasswordValue } from '../../../functions/resolve1Password.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../../../.env') });
dotenv.config();

const OPENAI_API_KEY = resolve1PasswordValue(process.env.OPENAI_API_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const EMBEDDING_MODEL = 'text-embedding-3-small';
const SCORE_THRESHOLD = 0.5;

/** Query phrases: one per key-moment type. Same model as embeddings. */
const QUERY_PHRASES = {
  demo_walkthrough:
    "Let me show you how the product works. I'll walk through the screen and show you the main flow step by step. Share screen. Here's what you'd see when you click in. So on screen we have a few...",
  technical_explanation:
    'Under the hood it works like this. The architecture and technical details.',
  objection_handling: "I hear your concern. Here's how we've seen other teams handle that.",
  customer_question: 'Can it do that? How do you handle that? What about integration?',
  best_practice: "Here's how we recommend doing it. Best practice is to start with.",
};

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function extractKeyMoments(embeddingsPath) {
  const rows = JSON.parse(readFileSync(embeddingsPath, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      'Embeddings file must be a non-empty array of { chunkIndex, timestamp, speaker, text, embedding }',
    );
  }

  const labels = Object.keys(QUERY_PHRASES);
  const texts = labels.map((k) => QUERY_PHRASES[k]);
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  const queryEmbeddings = labels.map((_, i) => response.data[i].embedding);

  const keyMoments = [];
  for (const row of rows) {
    let bestLabel = null;
    let bestScore = -1;
    for (let q = 0; q < queryEmbeddings.length; q++) {
      const score = cosineSimilarity(row.embedding, queryEmbeddings[q]);
      if (score > bestScore) {
        bestScore = score;
        bestLabel = labels[q];
      }
    }
    if (bestScore >= SCORE_THRESHOLD && bestLabel) {
      keyMoments.push({
        chunkIndex: row.chunkIndex,
        timestamp: row.timestamp,
        speaker: row.speaker,
        text: row.text,
        label: bestLabel,
        score: Math.round(bestScore * 1000) / 1000,
      });
    }
  }

  const projectRoot = join(__dirname, '..');
  const outDir = join(projectRoot, 'data', 'key-moments');
  mkdirSync(outDir, { recursive: true });

  const stem = basename(embeddingsPath, '.json').replace(/_embeddings$/, '');
  const outPath = join(outDir, `${stem}_key_moments.json`);
  const out = { sourceFile: `${stem}.json`, keyMoments };
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(
    `Wrote ${keyMoments.length} key moments (threshold ${SCORE_THRESHOLD}) to ${outPath}`,
  );
}

const inputPath = process.argv[2];
if (inputPath) {
  extractKeyMoments(inputPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error('Usage: node extract_key_moments.js <embeddings_file>');
  console.error(
    'Example: node extract_key_moments.js data/embeddings/2026-01-20_disco_demo_embeddings.json',
  );
  process.exit(1);
}

export default extractKeyMoments;
