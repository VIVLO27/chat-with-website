export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
}
