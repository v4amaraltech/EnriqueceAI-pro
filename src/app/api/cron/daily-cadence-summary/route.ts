import crypto from 'crypto';

import { NextResponse } from 'next/server';

import { sendDailyCadenceSummary } from '@/features/cadences/actions/daily-summary';

function verifyAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization') ?? '';
  const expectedToken = process.env.CRON_SECRET;
  if (!expectedToken) return false;
  const expected = `Bearer ${expectedToken}`;
  try {
    return (
      Buffer.byteLength(authHeader) === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await sendDailyCadenceSummary();

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
