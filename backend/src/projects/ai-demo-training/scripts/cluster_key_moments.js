import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIMILARITY_THRESHOLD = 0.75;
const projectRoot = join(__dirname, '..');

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

function makeUnionFind(n) {
  const parent = [];
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(i) {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }

  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  }

  return { find, union };
}

function clusterBySimilarity(moments, threshold) {
  // If moments is empty
  if (moments.length === 0) return [];

  // If moments has only 1 moment
  if (moments.length === 1)
    return [{ clusterId: 0, chunkIndices: [moments[0].chunkIndex], count: 1 }];

  // Handle if moments is more than 1 moment
  const { find, union } = makeUnionFind(moments.length);

  // Loop through moments
  for (let i = 0; i < moments.length; i++) {
    for (let j = i + 1; j < moments.length; j++) {
      if (cosineSimilarity(moments[i].embedding, moments[j].embedding) >= threshold) {
        union(i, j);
      }
    }
  }

  // Get Chunk Index per moment, build out Groups
  const groups = {};
  for (let i = 0; i < moments.length; i++) {
    const root = find(i);
    if (groups[root] === undefined) {
      groups[root] = [];
    }
    groups[root].push(moments[i].chunkIndex);
  }

  // Get Cluster
  const clusterArrays = Object.values(groups);
  const clusters = clusterArrays.map((chunkIndices, clusterId) => {
    chunkIndices.sort((a, b) => a - b);
    return { clusterId, chunkIndices, count: chunkIndices.length };
  });
  return clusters;
}

function loadKeyMomentsAndEmbedding(keyMomentsPath) {
  const resolvedPath = resolve(keyMomentsPath);

  // Read File
  const keyMomentsData = JSON.parse(readFileSync(resolvedPath, 'utf-8'));

  // Extract KeyMoments and SourceFile
  const keyMoments = keyMomentsData.keyMoments;
  const sourceFile = keyMomentsData.sourceFile;

  // Derive the stem from the key-moments filename
  const keyMomentsFileName = basename(resolvedPath);
  const stem = keyMomentsFileName.replace(/_key_moments\.json$/, '');

  // Build embeddings file
  const embeddingsPath = join(projectRoot, 'data', 'embeddings', `${stem}_embeddings.json`);
  const embeddingsArray = JSON.parse(readFileSync(embeddingsPath, 'utf-8'));

  // Build map for ChunkIndex -> Embedding
  const embeddingByChunk = new Map();
  for (const row of embeddingsArray) {
    embeddingByChunk.set(row.chunkIndex, row.embedding);
  }

  // Join key moments with embeddings
  const momentsWithEmbeddings = [];
  keyMoments.forEach((item) => {
    const embedding = embeddingByChunk.get(item.chunkIndex);

    if (embedding === undefined) {
      console.warn(`Chunk index ${item.chunkIndex} missing, skipping`);
    } else {
      momentsWithEmbeddings.push({ ...item, embedding });
    }
  });

  return {
    momentsWithEmbeddings,
    sourceFile,
    stem,
    keyMomentsPath: resolvedPath,
    embeddingsPath,
    embeddingsFile: `${stem}_embeddings.json`,
    keyMomentsFile: `${stem}_key_moments.json`,
  };
}

function buildClusterByLabel(momentsWithEmbeddings) {
  // Group moments by label
  const byLabel = [];
  momentsWithEmbeddings.forEach((moment) => {
    if (byLabel[moment.label] === undefined) {
      byLabel[moment.label] = [];
    }
    byLabel[moment.label].push(moment);
  });

  const clusterByLabel = [];
  const keyMomentsWithCluster = [];

  for (const label of Object.keys(byLabel)) {
    const labelMoments = byLabel[label];
    const clusters = clusterBySimilarity(labelMoments, SIMILARITY_THRESHOLD);
    clusterByLabel[label] = clusters;

    for (const moment of labelMoments) {
      const cluster = clusters.find((c) => c.chunkIndices.includes(moment.chunkIndex));
      if (cluster) {
        keyMomentsWithCluster.push({
          chunkIndex: moment.chunkIndex,
          label,
          clusterId: cluster.clusterId,
        });
      }
    }
  }

  return { clusterByLabel, keyMomentsWithCluster };
}

function writeOutput(
  stem,
  sourceFile,
  embeddingsFile,
  keyMomentsFile,
  clusterByLabel,
  keyMomentsWithCluster,
) {
  const outDir = join(projectRoot, 'data', 'clusters');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${stem}_clusters.json`);
  const payload = {
    sourceFile,
    embeddingsFile,
    keyMomentsFile,
    clustersByLabel: clusterByLabel,
    keyMomentsWithCluster,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  const totalClusters = Object.values(clusterByLabel).reduce((sum, arr) => sum + arr.length, 0);
  console.log(
    `Wrote ${keyMomentsWithCluster.length} key moments in ${totalClusters} clusters to ${outPath}`,
  );
}

function clusterKeyMoments(keyMomentsPath) {
  const loaded = loadKeyMomentsAndEmbedding(keyMomentsPath);
  const { clusterByLabel, keyMomentsWithCluster } = buildClusterByLabel(
    loaded.momentsWithEmbeddings,
  );
  writeOutput(
    loaded.stem,
    loaded.sourceFile,
    loaded.embeddingsFile,
    loaded.keyMomentsFile,
    clusterByLabel,
    keyMomentsWithCluster,
  );
}

const inputFile = process.argv[2];
if (inputFile) {
  try {
    clusterKeyMoments(inputFile);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
} else {
  console.error('Usage: node cluster_key_moments.js <key_moments_file>');
  console.error(
    'Example: node cluster_key_moments.js data/key-moments/2026-01-20_disco_demo_key_moments.json',
  );
  process.exit(1);
}
