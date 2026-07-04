import { streamRagResponse } from '@/lib/rag';
import { getSession } from '@/lib/sessions/store';

export const runtime = 'nodejs';

function sseEncode(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  data: unknown
) {
  try {
    controller.enqueue(sseEncode(data));
  } catch {
    // Stream already closed by client
  }
}

// NEW: A safe wrapper for closing the controller to prevent race conditions
function safeClose(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.close();
  } catch {
    // Controller is already closed, ignore the Node.js Invalid State error
  }
}

export async function POST(request: Request) {
  let body: {
    sessionId?: string;
    question?: string;
    signal: AbortSignal
    history?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { sessionId, question, history = [] } = body;

  if (!sessionId || !question?.trim()) {
    return Response.json(
      { error: 'sessionId and question are required' },
      { status: 400 }
    );
  }

  const session = getSession(sessionId);

  if (!session) {
    return Response.json(
      { error: 'Session not found' },
      { status: 404 }
    );
  }

  if (session.status !== 'ready') {
    return Response.json(
      {
        error: `Session is not ready (status: ${session.status})`,
      },
      { status: 409 }
    );
  }

  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const {
          stream: geminiStream,
          sources,
          lowConfidence,
        } = await streamRagResponse(
          sessionId,
          question.trim(),
          history,
          signal
        );

        if (signal.aborted) return;

        safeEnqueue(controller, {
          type: 'meta',
          sources,
          lowConfidence,
        });

        for await (const chunk of geminiStream) {
          if (signal.aborted) {
            break;
          }

          const text = chunk.text;

          if (text) {
            safeEnqueue(controller, {
              type: 'text',
              text,
            });
          }
        }

        if (!signal.aborted) {
          safeEnqueue(controller, {
            type: 'done',
          });
          // FIXED: Replaced standard close with safeClose
          safeClose(controller);
        }
      } catch (err) {
        let message = 'Chat failed';

        if (err instanceof Error) {
          if (err.name === 'AbortError') return;

          message = err.message;

          try {
            const parsed = JSON.parse(message);
            message =
              parsed?.error?.message ||
              parsed?.error?.status ||
              message;
          } catch {
            // Keep original message
          }
        }

        if (!signal.aborted) {
          safeEnqueue(controller, {
            type: 'error',
            message,
          });
          // FIXED: Replaced standard close with safeClose
          safeClose(controller);
        }
      }
    },

    cancel() {
      console.log('SSE client disconnected.');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
