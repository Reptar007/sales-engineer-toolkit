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
const BATCH_SIZE = 50;

async function generateEmbeddings(transcriptFile) {
  const transcriptText = JSON.parse(readFileSync(transcriptFile, 'utf8'));
  const transcript = transcriptText.transcript;

  const chunks = transcript.map((turn, index) => ({
    chunkIndex: index,
    timestamp: turn.timestamp,
    speaker: turn.speaker,
    text: turn.text,
  }));

  const results = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });
    for (let j = 0; j < batch.length; j++) {
      results.push({
        ...batch[j],
        embedding: response.data[j].embedding,
      });
    }
  }

  const projectRoot = join(__dirname, '..');
  const embeddingsDir = join(projectRoot, 'data', 'embeddings');
  mkdirSync(embeddingsDir, { recursive: true });

  const baseName = basename(transcriptFile, '.json');
  const outPath = join(embeddingsDir, `${baseName}_embeddings.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Wrote ${results.length} embeddings to ${outPath}`);
}

const inputFile = process.argv[2];
if (inputFile) {
  generateEmbeddings(inputFile).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error('Usage: node generate_embeddings.js <transcript_file>');
  process.exit(1);
}

export default generateEmbeddings;
