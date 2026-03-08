import { NextResponse } from 'next/server';

import { checkEmailReplies } from '@/features/cadences/actions/check-email-replies';

function verifyAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const expectedToken = process.env.CRON_SECRET;
  return !!expectedToken && authHeader === `Bearer ${expectedToken}`;
}

export async function POST(request: Request) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await checkEmailReplies();

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
