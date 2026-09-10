import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';
import { isUuid } from '@/lib/utils/uuid';
import {
  dialerGatewayForOrg,
  dialerPassesWebhookConstraint,
  summarizeIntegration,
  summarizeRecentCall,
} from '@/features/integrations/services/api4com-diagnostics';

export const maxDuration = 60;

// Diagnóstico SOMENTE LEITURA (GET na API4COM, nada é alterado). Body opcional
// `{ "orgId": "<uuid>" }` restringe a uma org. A resposta nunca traz api key nem
// o token do webhook — ver `api4com-diagnostics.ts`.
export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { orgId?: unknown };
  const orgId = typeof body.orgId === 'string' && isUuid(body.orgId) ? body.orgId : null;

  const supabase = createServiceRoleClient();

  let query = from(supabase, 'api4com_connections' as never)
    .select('org_id, user_id, ramal, api_key_encrypted, base_url')
    .eq('status', 'connected');
  if (orgId) query = query.eq('org_id', orgId);

  const { data: connections } = (await query) as {
    data: Array<{
      org_id: string;
      user_id: string;
      ramal: string;
      api_key_encrypted: string;
      base_url: string;
    }> | null;
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

        const [intResponse, callsResponse] = await Promise.all([
          fetch(`${baseUrl}/integrations`, { method: 'GET', headers: hdrs }),
          fetch(`${baseUrl}/calls?page=1`, { method: 'GET', headers: hdrs }),
        ]);

        const integrationsRaw = intResponse.ok ? ((await intResponse.json()) as unknown) : null;
        const integrations = Array.isArray(integrationsRaw)
          ? integrationsRaw.map(summarizeIntegration)
          : [];

        let recentCalls: ReturnType<typeof summarizeRecentCall>[] = [];
        if (callsResponse.ok) {
          const callsData = (await callsResponse.json()) as { data?: unknown[] };
          recentCalls = (callsData?.data ?? []).slice(0, 5).map(summarizeRecentCall);
        }

        return {
          org_id: conn.org_id,
          user_id: conn.user_id,
          ramal: conn.ramal,
          dialerGateway: dialerGatewayForOrg(conn.org_id),
          integrationsStatus: intResponse.status,
          integrations: integrations.map((i) => ({
            ...i,
            dialerPassesConstraint: dialerPassesWebhookConstraint(i, conn.org_id),
          })),
          callsStatus: callsResponse.status,
          recentCalls,
        };
      } catch (err) {
        return { org_id: conn.org_id, ramal: conn.ramal, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return NextResponse.json({ results });
}
