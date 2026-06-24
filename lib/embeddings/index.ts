/**
 * embeddings/index.ts
 * Gemini embedding provider with batching for index builds.
 */

import { getGeminiClient, EMBEDDING_MODEL } from '../gemini/client';

const BATCH_SIZE = 20;
export const EMBEDDING_DIMENSIONS = 768;

export async function embedText(text: string, taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' = 'RETRIEVAL_QUERY'): Promise<number[]> {
  const ai = getGeminiClient();
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text.slice(0, 8000),
    config: {
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values) throw new Error('Embedding API returned no values');
  return values;
}

export async function embedBatch(
  texts: string[],
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' = 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, 8000));
    const batchResults = await Promise.all(
      batch.map((text) => embedText(text, taskType))
    );
    results.push(...batchResults);

    if (i + BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}
