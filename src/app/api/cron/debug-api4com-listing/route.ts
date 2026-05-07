// TEMPORARY debug endpoint — remove after diagnosing recover-missing-recordings notFound issue
import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Pick the V4 Amaral connection (any connected one in that org)
  // Use Guilherme's credentials specifically (he has 22 calls without recording)
  const { data: conn } = (await from(supabase, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url, ramal, user_id')
    .eq('user_id', 'e2f24cd5-ce36-495b-840f-88900bf989e5')
    .eq('status', 'connected')
    .maybeSingle()) as { data: { api_key_encrypted: string; base_url: string; ramal: string; user_id: string } | null };

  if (!conn?.api_key_encrypted) {
    return NextResponse.json({ error: 'no connection' }, { status: 500 });
  }

  const apiKey = decrypt(conn.api_key_encrypted);
  const baseUrl = conn.base_url.replace(/\/$/, '');

  const targetCallId = '86d80879-fe2a-4ed5-9a85-9d810ba6a830';
  const targetDestSuffix = '31455000'; // (47) 3145-5000 → 4731455000 → match last 8

  const out: Record<string, unknown> = {
    base_url: baseUrl,
    ramal: conn.ramal,
    user_id: conn.user_id,
    apiKey_length: apiKey.length,
    apiKey_prefix: apiKey.slice(0, 8),
    matches_by_destination: [] as unknown[],
    target_id_found_at: null as null | number,
    pages_summary: [] as unknown[],
  };

  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${baseUrl}/calls?page=${page}`, {
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }

    if (!json || typeof json !== 'object') {
      (out.pages_summary as unknown[]).push({ page, status: r.status, error: text.slice(0, 200) });
      continue;
    }

    const j = json as Record<string, unknown>;
    const records = (j.data as Array<Record<string, unknown>>) ?? [];

    if (records.length === 0) {
      (out.pages_summary as unknown[]).push({ page, status: r.status, recordCount: 0 });
      break;
    }

    const firstStarted = records[0]?.started_at as string | undefined;
    const lastStarted = records[records.length - 1]?.started_at as string | undefined;
    (out.pages_summary as unknown[]).push({
      page, status: r.status, recordCount: records.length, firstStarted, lastStarted,
    });

    if (records.find((rec) => rec.id === targetCallId)) {
      out.target_id_found_at = page;
    }

    for (const rec of records) {
      const to = String(rec.to ?? '').replace(/\D/g, '');
      if (to.endsWith(targetDestSuffix)) {
        (out.matches_by_destination as unknown[]).push({
          page,
          id: rec.id,
          to: rec.to,
          started_at: rec.started_at,
          duration: rec.duration,
          record_url: rec.record_url,
          from: rec.from,
        });
      }
    }
  }

  return NextResponse.json(out);
}

export async function GET(request: Request) {
  return POST(request);
}
