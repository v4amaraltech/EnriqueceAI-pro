import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
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

  // Parallelize API checks across all connections
  const results = await Promise.all(
    connections.map(async (conn) => {
      try {
        const apiKey = decrypt(conn.api_key_encrypted);
        const baseUrl = conn.base_url.replace(/\/+$/, '');
        const hdrs = { 'Content-Type': 'application/json', Authorization: apiKey };

        // Parallel fetch: integrations + recent calls per connection
        const [_intResponse, callsResponse] = await Promise.all([
          fetch(`${baseUrl}/integrations`, { method: 'GET', headers: hdrs }),
          fetch(`${baseUrl}/calls?page=1`, { method: 'GET', headers: hdrs }),
        ]);

        let recentCalls: Record<string, unknown>[] = [];
        if (callsResponse.ok) {
          const callsData = (await callsResponse.json()) as { data: Record<string, unknown>[] };
          recentCalls = (callsData?.data ?? []).slice(0, 3).map((c) => ({
            id: c.id, to: c.to, from: c.from, started_at: c.started_at,
            duration: c.duration, record_url: c.record_url,
          }));
        }

        return { ramal: conn.ramal, recentCalls };
      } catch (err) {
        return { ramal: conn.ramal, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return NextResponse.json({ results });
}
