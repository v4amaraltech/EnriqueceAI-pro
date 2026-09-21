import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { reconcileMeetingRequests } from '@/features/bdr-agenda/actions/reconcile-meeting-requests';

export const maxDuration = 120;

async function handle(request: Request) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await reconcileMeetingRequests();
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, data: result.data });
}
export const POST = handle;
export const GET = handle;
