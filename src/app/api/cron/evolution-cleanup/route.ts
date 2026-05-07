import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';

export const maxDuration = 60;

/**
 * Wrapper that lets pg_cron trigger the evolution-cleanup Edge Function using
 * only the cron secret. The Edge Function itself authenticates via service-role,
 * which we read from the Vercel env here so the key never lands in cron.job.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Missing Supabase configuration (URL or service role key)' },
      { status: 500 },
    );
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/evolution-cleanup`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    const text = await r.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }

    return NextResponse.json({ ok: r.ok, edge_status: r.status, edge_body: body }, { status: r.ok ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reach Edge Function';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
