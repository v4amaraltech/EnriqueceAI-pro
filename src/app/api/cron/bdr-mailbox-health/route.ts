import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { checkBdrMailboxHealth } from '@/features/bdr-admission/actions/mailbox-health';

async function handle(request: Request) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const r = await checkBdrMailboxHealth();
  return NextResponse.json({ ok: r.success, data: r.data }, { status: r.success ? 200 : 500 });
}
export const POST = handle;
export const GET = handle;
