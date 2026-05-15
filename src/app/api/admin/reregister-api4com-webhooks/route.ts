import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';
import { getAppUrl } from '@/lib/utils/app-url';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const appUrl = getAppUrl();
  const webhookSecret = process.env.API4COM_WEBHOOK_SECRET;
  const webhookUrl = webhookSecret
    ? `${appUrl}/api/webhooks/api4com?token=${webhookSecret}`
    : `${appUrl}/api/webhooks/api4com`;

  const { data: connections } = (await from(supabase, 'api4com_connections' as never)
    .select('user_id, api_key_encrypted, base_url, org_id')
    .eq('status', 'connected')) as {
    data: Array<{ user_id: string; api_key_encrypted: string; base_url: string; org_id: string }> | null;
  };

  if (!connections?.length) {
    return NextResponse.json({ message: 'No connections found', registered: 0 });
  }

  // Parallelize webhook registration across all connections
  const results = await Promise.all(
    connections.map(async (conn) => {
      try {
        const apiKey = decrypt(conn.api_key_encrypted);
        const reqUrl = `${conn.base_url.replace(/\/+$/, '')}/integrations`;

        // 1. GET existing integration to learn id + actual gateway
        const getRes = await fetch(reqUrl, {
          headers: { Authorization: apiKey },
        });
        if (!getRes.ok) {
          const text = await getRes.text();
          return { userId: conn.user_id, success: false, error: `GET ${getRes.status}: ${text}` };
        }
        const integrations = (await getRes.json()) as Array<{
          id: number;
          gateway: string;
          metadata: Record<string, unknown> | null;
        }>;
        if (!Array.isArray(integrations) || integrations.length === 0) {
          return { userId: conn.user_id, success: false, error: 'no integration found' };
        }
        const integration = integrations[0]!;

        // 2. PATCH with id + preserve existing metadata + enable webhook
        const reqBody = {
          id: integration.id,
          webhook: true,
          webhookConstraint: { metadata: { gateway: integration.gateway } },
          metadata: {
            ...(integration.metadata ?? {}),
            webhookUrl,
            webhookVersion: 'v1.4',
            webhookTypes: ['channel-hangup', 'channel-answer'],
          },
        };
        const response = await fetch(reqUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: apiKey },
          body: JSON.stringify(reqBody),
        });

        if (!response.ok) {
          const text = await response.text();
          return { userId: conn.user_id, success: false, error: `PATCH ${response.status}: ${text}` };
        }
        return { userId: conn.user_id, success: true };
      } catch (err) {
        return { userId: conn.user_id, success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const registered = results.filter((r) => r.success).length;
  return NextResponse.json({ registered, total: connections.length, results });
}
