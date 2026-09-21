import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { ingestEmailInbox } from '@/features/email-conversations/actions/ingest-email-inbox';

export const maxDuration = 300;

async function handle(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await ingestEmailInbox();
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, data: result.data });
}

// pg_cron usa net.http_post → POST; GET fica para depuração manual
export const POST = handle;
export const GET = handle;
