import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { decrypt } from '@/lib/security/encryption';

import type { Api4ComCallListResponse, Api4ComCallRecord } from '@/features/integrations/types/api4com';
import type { CallStatus } from '@/features/calls/types';

export const maxDuration = 300; // 5 min — may process many pages

// Same mapping as the webhook handler
const hangupCauseToStatus: Record<string, CallStatus> = {
  NO_ANSWER: 'no_contact',
  NO_USER_RESPONSE: 'no_contact',
  USER_BUSY: 'busy',
  CALL_REJECTED: 'not_connected',
  UNALLOCATED_NUMBER: 'not_connected',
  INVALID_NUMBER_FORMAT: 'not_connected',
  ORIGINATOR_CANCEL: 'not_connected',
  NORMAL_TEMPORARY_FAILURE: 'not_connected',
  RECOVERY_ON_TIMER_EXPIRE: 'not_connected',
};

function deriveStatus(record: Api4ComCallRecord): CallStatus {
  // If the call has duration > 0 and was answered, it's significant
  if (record.duration > 0) {
    return 'significant';
  }

  // Check hangup cause
  const mapped = hangupCauseToStatus[record.hangup_cause];
  if (mapped) return mapped;

  // NORMAL_CLEARING without duration = no_contact
  if (record.hangup_cause === 'NORMAL_CLEARING') {
    return 'no_contact';
  }

  return 'not_connected';
}

interface ConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  ramal: string;
  api_key_encrypted: string;
  base_url: string;
}

interface LocalCallRow {
  id: string;
  status: CallStatus;
  duration_seconds: number;
  recording_url: string | null;
  metadata: Record<string, string> | null;
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // 1. Get all active Api4Com connections
  const { data: connections } = (await from(supabase, 'api4com_connections' as never)
    .select('id, org_id, user_id, ramal, api_key_encrypted, base_url')
    .eq('status', 'connected')) as { data: ConnectionRow[] | null };

  if (!connections || connections.length === 0) {
    return NextResponse.json({ message: 'No active Api4Com connections', updated: 0 });
  }

  let totalUpdated = 0;
  let totalChecked = 0;
  const errors: string[] = [];

  // Re-register webhook for all connections (ensures webhook URL has auth token)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.enriqueceai.com.br';
  const webhookSecret = process.env.API4COM_WEBHOOK_SECRET;
  const webhookUrl = webhookSecret
    ? `${appUrl}/api/webhooks/api4com?token=${webhookSecret}`
    : `${appUrl}/api/webhooks/api4com`;

  for (const conn of connections) {
    try {
      const apiKey = decrypt(conn.api_key_encrypted);
      const baseUrl = conn.base_url.replace(/\/$/, '');

      // Re-register webhook (idempotent — safe to call every time)
      const gateway = `flux-${conn.org_id}`;
      try {
        await fetch(`${baseUrl}/integrations`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: apiKey },
          body: JSON.stringify({
            gateway,
            webhook: true,
            webhookConstraint: { gateway },
            metadata: { webhookUrl, webhookVersion: '1.8', webhookTypes: ['channel-hangup'] },
          }),
        });
      } catch (webhookErr) {
        console.warn(`[reconcile] webhook re-register failed for ${conn.ramal}:`, webhookErr);
      }

      // 2. Fetch local calls for this user that might need reconciliation
      //    Focus on calls with duration_seconds=0 or status='not_connected'
      const { data: localCalls } = (await from(supabase, 'calls')
        .select('id, status, duration_seconds, recording_url, metadata')
        .eq('user_id', conn.user_id)
        .eq('org_id', conn.org_id)
        .or('duration_seconds.eq.0,status.eq.not_connected')
        .order('created_at', { ascending: false })
        .limit(500)) as { data: LocalCallRow[] | null };

      if (!localCalls || localCalls.length === 0) continue;

      // Build lookup by api4com_call_id
      const localByApi4ComId = new Map<string, LocalCallRow>();
      for (const call of localCalls) {
        const api4comId = call.metadata?.api4com_call_id;
        if (api4comId) {
          localByApi4ComId.set(api4comId, call);
        }
      }

      if (localByApi4ComId.size === 0) continue;

      // 3. Fetch calls from Api4Com API (paginate)
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({ page: String(page) });
        const response = await fetch(`${baseUrl}/calls?${params.toString()}`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
          },
        });

        if (!response.ok) {
          errors.push(`User ${conn.user_id}: API error ${response.status} on page ${page}`);
          break;
        }

        const data = (await response.json()) as Api4ComCallListResponse;
        const records = data.data ?? [];

        // 4. Match and update
        for (const record of records) {
          totalChecked++;
          const localCall = localByApi4ComId.get(record.id);
          if (!localCall) continue;

          const updates: Record<string, unknown> = {};
          let needsUpdate = false;

          // Update duration if local is 0 and remote has value
          if (localCall.duration_seconds === 0 && record.duration > 0) {
            updates.duration_seconds = record.duration;
            needsUpdate = true;
          }

          // Update status if local is 'not_connected' but remote data suggests otherwise
          if (localCall.status === 'not_connected') {
            const derivedStatus = deriveStatus(record);
            if (derivedStatus !== 'not_connected') {
              updates.status = derivedStatus;
              needsUpdate = true;
            }
          }

          // Update recording URL if missing
          if (!localCall.recording_url && record.record_url) {
            updates.recording_url = record.record_url;
            needsUpdate = true;
          }

          if (needsUpdate) {
            updates.updated_at = new Date().toISOString();
            await from(supabase, 'calls').update(updates).eq('id', localCall.id);
            totalUpdated++;
          }

          // Remove from map once processed
          localByApi4ComId.delete(record.id);
        }

        // Check if we still have unmatched local calls and more pages
        hasMore = (data.metadata?.nextPage ?? null) !== null && localByApi4ComId.size > 0;
        page++;

        // Safety limit: don't fetch more than 20 pages
        if (page > 20) break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`User ${conn.user_id}: ${msg}`);
    }
  }

  return NextResponse.json({
    message: 'Reconciliation complete',
    connections: connections.length,
    checked: totalChecked,
    updated: totalUpdated,
    errors: errors.length > 0 ? errors : undefined,
  });
}
