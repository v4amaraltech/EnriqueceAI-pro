import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { checkEmailReplies } from '@/features/cadences/actions/check-email-replies';

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await checkEmailReplies();

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
