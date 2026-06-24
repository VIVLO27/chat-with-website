import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { crawlSite } from '@/lib/crawler';
import { embedBatch } from '@/lib/embeddings';
import { buildIndex } from '@/lib/vectorstore';
import { createSession, updateSession } from '@/lib/sessions/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

function sseEncode(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return Response.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const sessionId = uuidv4();
  createSession(sessionId, url);

  const stream = new ReadableStream({
    async start(controller) {
      const emitter = new EventEmitter();
      emitter.on('progress', (event) => {
        controller.enqueue(sseEncode({ ...event, sessionId }));
      });

      try {
        const result = await crawlSite(url, emitter);

        if (result.chunks.length === 0) {
          updateSession(sessionId, {
            status: 'error',
            errorMessage: 'No indexable content found on this site.',
            pages: result.pages,
            pageCount: result.pages.length,
            chunkCount: 0,
          });
          controller.enqueue(
            sseEncode({
              type: 'error',
              sessionId,
              message: 'No indexable content found. The site may be JavaScript-only or blocked.',
            })
          );
          controller.close();
          return;
        }

        updateSession(sessionId, {
          status: 'indexing',
          pages: result.pages,
          pageCount: result.pages.length,
        });

        controller.enqueue(
          sseEncode({
            type: 'progress',
            sessionId,
            pagesCrawled: result.pages.length,
            message: `Embedding ${result.chunks.length} chunks...`,
          })
        );

        const embeddings = await embedBatch(
          result.chunks.map((c) => c.text),
          'RETRIEVAL_DOCUMENT'
        );
        await buildIndex(sessionId, result.chunks, embeddings);

        updateSession(sessionId, {
          status: 'ready',
          chunkCount: result.chunks.length,
          pageCount: result.pages.length,
          pages: result.pages,
        });

        controller.enqueue(
          sseEncode({
            type: 'complete',
            sessionId,
            pagesCrawled: result.pages.length,
            chunkCount: result.chunks.length,
            message: `Ready! Indexed ${result.pages.length} pages.`,
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Crawl failed';
        updateSession(sessionId, { status: 'error', errorMessage: message });
        controller.enqueue(sseEncode({ type: 'error', sessionId, message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
