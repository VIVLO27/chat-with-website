/**
 * chunker.ts
 * Splits cleaned page text into overlapping chunks for embedding.
 *
 * Strategy: sliding window over sentences/paragraphs.
 * - Target: ~400 words per chunk (~512 tokens)
 * - Overlap: ~50 words
 * This balances context completeness with retrieval precision.
 */

export interface TextChunk {
  text: string;
  url: string;
  title: string;
  chunkIndex: number;
  totalChunks?: number;
}

const TARGET_WORDS = 400;
const OVERLAP_WORDS = 50;

/**
 * Split text into chunks with overlap, preserving paragraph/sentence boundaries.
 */
export function chunkText(
  text: string,
  url: string,
  title: string
): TextChunk[] {
  if (!text || text.trim().length === 0) return [];

  // Split into paragraphs first, then sentences within
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const sentences: string[] = [];
  for (const para of paragraphs) {
    // Split paragraph into sentences (simple heuristic)
    const paraSentences = para
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    sentences.push(...paraSentences);
    sentences.push(''); // paragraph boundary marker
  }

  const chunks: TextChunk[] = [];
  let currentWords: string[] = [];
  let chunkIndex = 0;

  const flushChunk = () => {
    const text = currentWords.join(' ').trim();
    if (text.length > 50) {
      chunks.push({ text, url, title, chunkIndex });
      chunkIndex++;
    }
  };

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter((w) => w.length > 0);

    if (currentWords.length + words.length > TARGET_WORDS) {
      flushChunk();
      // Keep overlap: last OVERLAP_WORDS words from current chunk
      currentWords = currentWords.slice(-OVERLAP_WORDS);
    }

    currentWords.push(...words);
  }

  // Flush remaining text
  if (currentWords.length > 0) {
    flushChunk();
  }

  // Set totalChunks
  return chunks.map((c) => ({ ...c, totalChunks: chunks.length }));
}
