import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';

export const maxDuration = 60;

/**
 * Diagnostic probe to discover whether API4COM has an endpoint that exposes
 * voicemail calls — the gap analysis (briefing 2026-05-17) found ~60 voicemail
 * (Caixa postal) calls appear in the dashboard CSV export but never get
 * returned by GET /calls. Without a way to fetch them, Enriquece will keep
 * undercounting voicemails until API4COM either fixes /calls or exposes a
 * dedicated endpoint.
 *
 * Probes a list of candidate endpoint shapes against one connected ramal of
 * V4 Amaral and reports back the HTTP status + a preview of each response.
 * Run via:
 *   curl -X POST .../api/admin/probe-api4com-voicemail \
 *     -H 'Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"orgId":"c2727473-1df8-4faa-9264-a9fc1759fe3b"}'
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { orgId?: string };
  if (!body.orgId) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: connections } = (await from(supabase, 'api4com_connections' as never)
    .select('user_id, ramal, api_key_encrypted, base_url')
    .eq('org_id', body.orgId)
    .eq('status', 'connected')
    .limit(1)) as {
    data: Array<{ user_id: string; ramal: string; api_key_encrypted: string; base_url: string }> | null;
  };

  if (!connections?.length) {
    return NextResponse.json({ error: 'No connected api4com_connections for orgId' }, { status: 404 });
  }

  const conn = connections[0]!;
  let apiKey: string;
  try {
    apiKey = decrypt(conn.api_key_encrypted);
  } catch (err) {
    return NextResponse.json({ error: `decrypt failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 });
  }
  const baseUrl = conn.base_url.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: apiKey };

  // Candidate paths/queries to probe. None of these are documented to us —
  // the point is to learn from API4COM's response shape what's exposed.
  const candidates = [
    { name: '/voicemails', path: '/voicemails' },
    { name: '/messages', path: '/messages' },
    { name: '/recordings', path: '/recordings' },
    { name: '/calls/voicemails', path: '/calls/voicemails' },
    { name: '/calls?include_voicemail=true', path: '/calls?include_voicemail=true&page=1' },
    { name: '/calls?has_voicemail=true', path: '/calls?has_voicemail=true&page=1' },
    { name: '/calls?status=voicemail', path: '/calls?status=voicemail&page=1' },
    { name: '/calls?type=voicemail', path: '/calls?type=voicemail&page=1' },
    { name: '/calls?call_type=voicemail', path: '/calls?call_type=voicemail&page=1' },
    { name: '/calls?direction=voicemail', path: '/calls?direction=voicemail&page=1' },
    { name: '/calls?is_voicemail=true', path: '/calls?is_voicemail=true&page=1' },
    { name: '/calls?include_all=true', path: '/calls?include_all=true&page=1' },
    { name: '/calls?show_inactive=true', path: '/calls?show_inactive=true&page=1' },
    { name: '/calls?with_metadata=true', path: '/calls?with_metadata=true&page=1' },
  ];

  const results = await Promise.all(
    candidates.map(async ({ name, path }) => {
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        const ct = res.headers.get('content-type') ?? '';
        let preview: unknown = null;
        if (res.ok && ct.includes('application/json')) {
          try {
            const json = await res.json();
            if (Array.isArray(json)) {
              preview = { kind: 'array', length: json.length, sample: json.slice(0, 1) };
            } else if (json && typeof json === 'object') {
              const j = json as Record<string, unknown>;
              const dataArr = Array.isArray(j.data) ? j.data : Array.isArray(j.calls) ? j.calls : null;
              preview = {
                kind: 'object',
                top_keys: Object.keys(j).slice(0, 10),
                metadata: j.metadata ?? null,
                sample: dataArr ? (dataArr as unknown[]).slice(0, 1) : j,
              };
            } else {
              preview = json;
            }
          } catch {
            preview = { kind: 'parse_error' };
          }
        } else {
          const text = await res.text();
          preview = { kind: 'text', body: text.slice(0, 300) };
        }
        return { name, status: res.status, ok: res.ok, content_type: ct, preview };
      } catch (err) {
        return { name, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return NextResponse.json({
    org_id: body.orgId,
    ramal: conn.ramal,
    base_url: baseUrl,
    probed: results,
  });
}
