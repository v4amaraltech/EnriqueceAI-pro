import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { expireInactiveLeads } from '@/features/cadences/actions/expire-inactive-leads';

export const maxDuration = 120;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await expireInactiveLeads();

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
