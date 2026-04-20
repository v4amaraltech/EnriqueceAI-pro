'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { decrypt } from '@/lib/security/encryption';
import { getAppUrl } from '@/lib/utils/app-url';

import type { Api4ComCallListResponse } from '@/features/integrations/types/api4com';

const callIdSchema = z.string().uuid('ID inválido');

/**
 * Fetch recording URL from API4COM for a call that has no recording stored locally.
 * Matches by api4com_call_id metadata or by phone + timestamp.
 */
export async function fetchCallRecording(
  callId: string,
): Promise<ActionResult<{ recording_url: string | null }>> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId: _orgId, userId: _userId, supabase } = auth.data;

  // 1. Get the call
  const { data: call } = (await from(supabase, 'calls')
    .select('id, recording_url, metadata, destination, started_at, created_at, user_id, origin, duration_seconds')
    .eq('id', callId)
    .single()) as {
    data: {
      id: string;
      recording_url: string | null;
      metadata: Record<string, string> | null;
      destination: string;
      started_at: string;
      created_at: string;
      user_id: string;
      origin: string | null;
      duration_seconds: number;
    } | null;
  };

  if (!call) return { success: false, error: 'Ligação não encontrada' };

  // Already has recording
  if (call.recording_url) {
    return { success: true, data: { recording_url: call.recording_url } };
  }

  // 2. Get API4COM credentials — try call's user first, then fallback to any org connection
  let conn: { api_key_encrypted: string; base_url: string; ramal: string } | null = null;

  const { data: userConn } = (await from(supabase, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url, ramal')
    .eq('user_id', call.user_id)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: { api_key_encrypted: string; base_url: string; ramal: string } | null;
  };
  conn = userConn;

  if (!conn?.api_key_encrypted) {
    // Fallback: any connected API4COM in the org
    const { data: orgConn } = (await from(supabase, 'api4com_connections' as never)
      .select('api_key_encrypted, base_url, ramal')
      .eq('org_id', _orgId)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle()) as {
      data: { api_key_encrypted: string; base_url: string; ramal: string } | null;
    };
    conn = orgConn;
  }

  if (!conn?.api_key_encrypted) {
    return { success: false, error: 'API4COM não configurada para nenhum usuário da organização' };
  }

  const apiKey = decrypt(conn.api_key_encrypted);
  const baseUrl = conn.base_url.replace(/\/$/, '');

  // 3. Try to find the call in API4COM by api4com_call_id or phone match
  const api4comCallId = call.metadata?.api4com_call_id;
  let recordingUrl: string | null = null;

  // Search recent pages from API4COM
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`${baseUrl}/calls?page=${page}`, {
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    });

    if (!response.ok) break;

    const data = (await response.json()) as Api4ComCallListResponse;
    const records = data.data ?? [];

    for (const record of records) {
      // Match by api4com_call_id
      if (api4comCallId && record.id === api4comCallId) {
        if (record.record_url) {
          recordingUrl = record.record_url;
          break;
        }
      }

      // Match by phone + timestamp (use started_at for better accuracy)
      if (!recordingUrl && record.record_url) {
        const rawTo = (record.to ?? '').replace(/\D/g, '');
        const rawFrom = (record.from ?? '').replace(/\D/g, '');
        const phoneKey = rawTo.slice(-8);
        const fromKey = rawFrom.slice(-8);
        const destKey = call.destination.replace(/\D/g, '').slice(-8);
        const originKey = (call.origin ?? '').replace(/\D/g, '').slice(-4);

        // Match destination OR origin (ramal)
        const phoneMatch = phoneKey === destKey || (originKey.length >= 3 && fromKey.endsWith(originKey));

        if (phoneMatch) {
          const remoteTime = new Date(record.started_at).getTime();
          const localTime = new Date(call.started_at ?? call.created_at).getTime();
          const timeDiff = Math.abs(remoteTime - localTime);
          // Duration must be within 30% tolerance to avoid mismatches
          const durationMatch = record.duration > 0 && call.duration_seconds > 0
            ? Math.abs(record.duration - call.duration_seconds) / Math.max(record.duration, call.duration_seconds) < 0.3
            : true; // skip check if either is 0

          // Time window: 10 minutes + duration must match
          if (timeDiff < 10 * 60 * 1000 && durationMatch) {
            recordingUrl = record.record_url;
            break;
          }
        }
      }
    }

    if (recordingUrl) break;
    if (!data.metadata?.nextPage) break;
  }

  // 4. Update local call if we found a recording
  if (recordingUrl) {
    await from(supabase, 'calls')
      .update({ recording_url: recordingUrl, updated_at: new Date().toISOString() })
      .eq('id', callId);

    // Trigger transcription if duration >= 30s
    const { data: callDuration } = (await from(supabase, 'calls')
      .select('duration_seconds')
      .eq('id', callId)
      .single()) as { data: { duration_seconds: number } | null };

    if (callDuration && callDuration.duration_seconds >= 30) {
      const appUrl = getAppUrl();
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (appUrl && serviceRoleKey) {
        fetch(`${appUrl}/api/workers/transcribe-call`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ callId }),
        }).catch((err) => console.error('[fetch-call-recording] Failed to trigger transcription:', err));
      }
    }

    return { success: true, data: { recording_url: recordingUrl } };
  }

  return {
    success: true,
    data: { recording_url: null },
  };
}
