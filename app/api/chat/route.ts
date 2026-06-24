import { streamRagResponse } from '@/lib/rag';
import { getSession } from '@/lib/sessions/store';

export const runtime = 'nodejs';

function sseEncode(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  let body: {
    sessionId?: string;
    question?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, question, history = [] } = body;

  if (!sessionId || !question?.trim()) {
    return Response.json({ error: 'sessionId and question are required' }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'ready') {
    return Response.json({ error: `Session is not ready (status: ${session.status})` }, { status: 409 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { stream: geminiStream, sources, lowConfidence } = await streamRagResponse(
          sessionId,
          question.trim(),
          history
        );

        controller.enqueue(
          sseEncode({ type: 'meta', sources, lowConfidence })
        );

        for await (const chunk of geminiStream) {
          const text = chunk.text;
          if (text) {
            controller.enqueue(sseEncode({ type: 'text', text }));
          }
        }

        controller.enqueue(sseEncode({ type: 'done' }));
      } catch (err) {
        let message = 'Chat failed';
        if (err instanceof Error) {
          message = err.message;
          try {
            const parsed = JSON.parse(message);
            message = parsed?.error?.message || parsed?.error?.status || message;
          } catch {
            // use raw message
          }
        }
        controller.enqueue(sseEncode({ type: 'error', message }));
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
