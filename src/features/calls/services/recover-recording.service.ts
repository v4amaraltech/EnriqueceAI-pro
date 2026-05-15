import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { decrypt } from '@/lib/security/encryption';

import type { Api4ComCallListResponse } from '@/features/integrations/types/api4com';
import { parseApi4ComTimestamp } from '@/features/integrations/services/api4com-time';

interface CallForRecovery {
  id: string;
  destination: string;
  origin: string | null;
  started_at: string | null;
  created_at: string;
  duration_seconds: number;
  user_id: string;
  org_id: string;
  metadata: Record<string, string> | null;
}

/**
 * Looks up the missing recording_url for a call directly against API4COM's REST API.
 * Used by the cron that catches calls whose channel-hangup webhook arrived before
 * the recording was ready (~86% of API4COM hangups in this org).
 *
 * Returns the recording URL if found, or null if not found / API4COM unreachable.
 * Does NOT update the DB — caller is responsible.
 */
export async function lookupRecordingFromApi4Com(
  supabase: SupabaseClient,
  call: CallForRecovery,
): Promise<string | null> {
  // Get API4COM credentials — try call's owner first, fall back to any connected one in the org
  const { data: userConn } = (await from(supabase, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url')
    .eq('user_id', call.user_id)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: { api_key_encrypted: string; base_url: string } | null;
  };

  let conn = userConn;
  if (!conn?.api_key_encrypted) {
    const { data: orgConn } = (await from(supabase, 'api4com_connections' as never)
      .select('api_key_encrypted, base_url')
      .eq('org_id', call.org_id)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle()) as {
      data: { api_key_encrypted: string; base_url: string } | null;
    };
    conn = orgConn;
  }

  if (!conn?.api_key_encrypted) return null;

  const apiKey = decrypt(conn.api_key_encrypted);
  const baseUrl = conn.base_url.replace(/\/$/, '');

  const api4comCallId = call.metadata?.api4com_call_id;
  const destKey = call.destination.replace(/\D/g, '').slice(-8);
  const originKey = (call.origin ?? '').replace(/\D/g, '').slice(-4);
  const localTime = new Date(call.started_at ?? call.created_at).getTime();

  // Search recent pages from API4COM (most recent first); cap at 10 pages to stay bounded.
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`${baseUrl}/calls?page=${page}`, {
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    });

    if (!response.ok) break;

    const data = (await response.json()) as Api4ComCallListResponse;
    const records = data.data ?? [];

    for (const record of records) {
      // 1. Direct ID match takes priority
      if (api4comCallId && record.id === api4comCallId && record.record_url) {
        return record.record_url;
      }

      // 2. Phone + timestamp + duration match (same heuristics used by the user-facing fetchCallRecording)
      if (record.record_url) {
        const rawTo = (record.to ?? '').replace(/\D/g, '');
        const rawFrom = (record.from ?? '').replace(/\D/g, '');
        const phoneKey = rawTo.slice(-8);
        const fromKey = rawFrom.slice(-8);
        const phoneMatch = phoneKey === destKey || (originKey.length >= 3 && fromKey.endsWith(originKey));

        if (phoneMatch) {
          const remoteDate = parseApi4ComTimestamp(record.started_at);
          const remoteTime = remoteDate ? remoteDate.getTime() : NaN;
          const timeDiff = Math.abs(remoteTime - localTime);
          const durationMatch = record.duration > 0 && call.duration_seconds > 0
            ? Math.abs(record.duration - call.duration_seconds) / Math.max(record.duration, call.duration_seconds) < 0.3
            : true;

          if (timeDiff < 10 * 60 * 1000 && durationMatch) {
            return record.record_url;
          }
        }
      }
    }

    if (!data.metadata?.nextPage) break;
  }

  return null;
}
