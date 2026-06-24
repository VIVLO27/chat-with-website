/**
 * rag/index.ts
 * Retrieval-Augmented Generation pipeline using Gemini.
 */

import { getGeminiClient, CHAT_MODEL } from '../gemini/client';
import { embedText } from '../embeddings';
import { queryIndex, type RetrievedChunk } from '../vectorstore';

const SIMILARITY_THRESHOLD = 0.35;
const TOP_K = 5;

export interface Source {
  url: string;
  title: string;
}

export interface RagContext {
  chunks: RetrievedChunk[];
  sources: Source[];
  lowConfidence: boolean;
}

export async function retrieveContext(
  sessionId: string,
  question: string
): Promise<RagContext> {
  const queryVector = await embedText(question, 'RETRIEVAL_QUERY');
  const chunks = await queryIndex(sessionId, queryVector, TOP_K);

  const seenUrls = new Set<string>();
  const sources: Source[] = [];
  for (const chunk of chunks) {
    if (!seenUrls.has(chunk.metadata.url)) {
      seenUrls.add(chunk.metadata.url);
      sources.push({ url: chunk.metadata.url, title: chunk.metadata.title });
    }
  }

  const lowConfidence =
    chunks.length === 0 || chunks.every((c) => c.score < SIMILARITY_THRESHOLD);

  return { chunks, sources, lowConfidence };
}

export function buildSystemPrompt(
  chunks: RetrievedChunk[],
  lowConfidence: boolean
): string {
  if (chunks.length === 0) {
    return `You are a helpful assistant for a website Q&A system. The user is asking about a specific website, but no relevant content was found in the website's index for their question. You MUST respond with something like: "I couldn't find information about this on the website." Do NOT make up or hallucinate any information.`;
  }

  const contextBlocks = chunks
    .map(
      (c, i) =>
        `[Context ${i + 1}] (Source: ${c.metadata.url})\n${c.metadata.text}`
    )
    .join('\n\n---\n\n');

  const confidenceNote = lowConfidence
    ? '\n\nNOTE: Retrieved context has low relevance scores. If the excerpts do not clearly answer the question, say you could not find the information on the website.'
    : '';

  return `You are a helpful assistant that answers questions based ONLY on the content of a specific website.

You have been given excerpts from that website below. Your job is to:
1. Answer the user's question using ONLY the provided context — do not use any outside knowledge.
2. If the context doesn't contain enough information to answer the question, say clearly: "I couldn't find information about this on the website."
3. Do NOT hallucinate, guess, or invent information that isn't in the context.
4. Keep your answer concise and accurate.
5. When relevant, you may reference which parts of the content support your answer.${confidenceNote}

--- WEBSITE CONTENT ---
${contextBlocks}
--- END OF CONTENT ---`;
}

export async function streamRagResponse(
  sessionId: string,
  question: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
) {
  const { chunks, sources, lowConfidence } = await retrieveContext(sessionId, question);
  const systemPrompt = buildSystemPrompt(chunks, lowConfidence);
  const ai = getGeminiClient();

  const contents = [
    ...conversationHistory.slice(-6).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.content }],
    })),
    { role: 'user' as const, parts: [{ text: question }] },
  ];

  const stream = await ai.models.generateContentStream({
    model: CHAT_MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      maxOutputTokens: 1024,
    },
  });

  return { stream, sources, lowConfidence };
}
