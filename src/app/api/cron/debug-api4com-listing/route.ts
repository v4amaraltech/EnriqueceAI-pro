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
  const { data: conn } = (await from(supabase, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url, ramal, user_id')
    .eq('org_id', 'c2727473-1df8-4faa-9264-a9fc1759fe3b')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle()) as { data: { api_key_encrypted: string; base_url: string; ramal: string; user_id: string } | null };

  if (!conn?.api_key_encrypted) {
    return NextResponse.json({ error: 'no connection' }, { status: 500 });
  }

  const apiKey = decrypt(conn.api_key_encrypted);
  const baseUrl = conn.base_url.replace(/\/$/, '');

  const targetCallId = '86d80879-fe2a-4ed5-9a85-9d810ba6a830'; // INESA call

  const out: Record<string, unknown> = {
    base_url: baseUrl,
    ramal: conn.ramal,
    user_id: conn.user_id,
    apiKey_length: apiKey.length,
    apiKey_prefix: apiKey.slice(0, 8),
    pages: [],
  };

  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`${baseUrl}/calls?page=${page}`, {
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    const pageInfo: Record<string, unknown> = {
      page,
      status: r.status,
      ok: r.ok,
    };
    if (json && typeof json === 'object') {
      const j = json as Record<string, unknown>;
      const records = (j.data as Array<Record<string, unknown>>) ?? [];
      pageInfo.recordCount = records.length;
      pageInfo.metadata = j.metadata;
      pageInfo.firstRecord = records[0];
      pageInfo.matchTarget = records.find((rec) => rec.id === targetCallId) ?? null;
      pageInfo.recordIds = records.slice(0, 5).map((rec) => rec.id);
    } else {
      pageInfo.bodyPreview = text.slice(0, 500);
    }
    (out.pages as unknown[]).push(pageInfo);
  }

  return NextResponse.json(out);
}

export async function GET(request: Request) {
  return POST(request);
}
