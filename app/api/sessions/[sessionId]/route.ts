import { getSession } from '@/lib/sessions/store';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = getSession(sessionId);

  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  return Response.json(session);
}
