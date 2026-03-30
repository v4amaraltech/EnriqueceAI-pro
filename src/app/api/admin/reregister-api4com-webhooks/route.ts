import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';
import { getAppUrl } from '@/lib/utils/app-url';

export const maxDuration = 60;

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
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

  const results: Array<{ userId: string; success: boolean; error?: string }> = [];

  for (const conn of connections) {
    const gateway = `flux-${conn.org_id}`;
    try {
      const apiKey = decrypt(conn.api_key_encrypted);
      const response = await fetch(`${conn.base_url}integrations`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify({
          gateway,
          webhook: true,
          webhookConstraint: { gateway },
          metadata: {
            webhookUrl,
            webhookVersion: '1.8',
            webhookTypes: ['channel-hangup'],
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        results.push({ userId: conn.user_id, success: false, error: `${response.status}: ${text}` });
      } else {
        results.push({ userId: conn.user_id, success: true });
      }
    } catch (err) {
      results.push({ userId: conn.user_id, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const registered = results.filter((r) => r.success).length;
  return NextResponse.json({ registered, total: connections.length, results });
}
