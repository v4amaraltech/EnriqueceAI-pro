import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';

export const maxDuration = 60;

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: connections } = (await from(supabase, 'api4com_connections' as never)
    .select('user_id, ramal, api_key_encrypted, base_url')
    .eq('status', 'connected')) as {
    data: Array<{ user_id: string; ramal: string; api_key_encrypted: string; base_url: string }> | null;
  };

  if (!connections?.length) {
    return NextResponse.json({ message: 'No connections', results: [] });
  }

  const results = [];

  for (const conn of connections) {
    try {
      const apiKey = decrypt(conn.api_key_encrypted);
      const baseUrl = conn.base_url.replace(/\/+$/, '');

      // Check integrations config
      const intResponse = await fetch(`${baseUrl}/integrations`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      });
      const intData = intResponse.ok ? await intResponse.json() : { error: intResponse.status };

      // Check recent calls for recording_url
      const callsResponse = await fetch(`${baseUrl}/calls?page=1`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      });
      let sampleCall = null;
      if (callsResponse.ok) {
        const callsData = await callsResponse.json();
        const calls = callsData?.data ?? [];
        sampleCall = calls.find((c: Record<string, unknown>) => c.record_url) ?? calls[0] ?? null;
      }

      results.push({
        ramal: conn.ramal,
        integrations: intData,
        sampleCall: sampleCall ? {
          id: sampleCall.id,
          duration: sampleCall.duration,
          record_url: sampleCall.record_url,
          hangup_cause: sampleCall.hangup_cause,
        } : null,
      });
    } catch (err) {
      results.push({ ramal: conn.ramal, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ results });
}
