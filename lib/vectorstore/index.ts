/**
 * vectorstore/index.ts
 * Simple file-backed vector index with cosine similarity search.
 *
 * Why not pgvector / Chroma / Vectra?
 * - Zero infrastructure and no native bundling issues with Next.js
 * - Brute-force cosine over ≤5000 chunks is fast enough for this scope
 * - Persists to disk as JSON per session
 *
 * Trade-off: O(n) search, full index loaded per query — not for production scale.
 */

import path from 'path';
import fs from 'fs';
import type { TextChunk } from '../crawler/chunker';

// On Vercel, process.cwd() is read-only; use /tmp for writable storage.
const BASE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data');
const DATA_DIR = path.join(BASE_DIR, 'sessions');

export interface ChunkMetadata {
  url: string;
  title: string;
  chunkIndex: number;
  text: string;
}

export interface RetrievedChunk {
  score: number;
  metadata: ChunkMetadata;
}

interface StoredItem {
  vector: number[];
  metadata: ChunkMetadata;
}

interface StoredIndex {
  items: StoredItem[];
}

function cosineSimilarity(a: number[], b: number[]): number {
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

function indexPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'index.json');
}

export function getSessionDir(sessionId: string): string {
  return path.join(DATA_DIR, sessionId);
}

function loadIndex(sessionId: string): StoredIndex {
  const file = indexPath(sessionId);
  if (!fs.existsSync(file)) {
    throw new Error(`Session index not found: ${sessionId}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as StoredIndex;
}

export async function buildIndex(
  sessionId: string,
  chunks: TextChunk[],
  embeddings: number[][]
): Promise<void> {
  const sessionDir = getSessionDir(sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const items: StoredItem[] = chunks.map((chunk, i) => ({
    vector: embeddings[i],
    metadata: {
      url: chunk.url,
      title: chunk.title,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
    },
  }));

  const payload: StoredIndex = { items };
  fs.writeFileSync(indexPath(sessionId), JSON.stringify(payload));
}

export async function queryIndex(
  sessionId: string,
  queryVector: number[],
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const { items } = loadIndex(sessionId);

  return items
    .map((item) => ({
      score: cosineSimilarity(queryVector, item.vector),
      metadata: item.metadata,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function sessionIndexExists(sessionId: string): boolean {
  return fs.existsSync(indexPath(sessionId));
}
