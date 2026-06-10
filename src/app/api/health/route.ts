import { NextResponse } from 'next/server';

// Lightweight liveness probe for Coolify (and any uptime monitor). Intentionally
// does not touch the database or any external service — it only confirms the
// Next.js server process is up and serving. Must stay dynamic so it is never
// cached/prerendered.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
