import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { decrypt } from '@/lib/security/encryption';

import type { Api4ComCallListResponse } from '@/features/integrations/types/api4com';
import { parseApi4ComTimestamp } from '@/features/integrations/services/api4com-time';

export const CALL_RECORDINGS_BUCKET = 'call-recordings';

/** Storage object path for a call's recording: `{org_id}/{call_id}.mp3`. */
export function callRecordingStoragePath(orgId: string, callId: string): string {
  return `${orgId}/${callId}.mp3`;
}

interface CallForRecording {
  id: string;
  org_id: string;
  metadata: Record<string, string> | null;
  destination: string;
  started_at: string | null;
  created_at: string;
  user_id: string;
  origin: string | null;
  duration_seconds: number;
}

/**
 * Resolve a *durable* recording URL from the API4COM `/calls` API.
 *
 * The webhook stores an ephemeral `listener.api4com.com/files/listen/...` link
 * that expires within hours. The API returns the durable `fs*.api4com.com`
 * file URL (`record_url`), which we use both to re-play and to persist to our
 * own Storage. Matches by api4com_call_id, falling back to phone + timestamp.
 *
 * Service-role client expected (reads encrypted api4com_connections).
 */
export async function resolveApi4ComRecordingUrl(
  supabase: SupabaseClient,
  call: CallForRecording,
): Promise<string | null> {
  // Credentials: prefer the call's user, fall back to any connected org conn.
  let conn: { api_key_encrypted: string; base_url: string } | null = null;

  const { data: userConn } = (await from(supabase, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url')
    .eq('user_id', call.user_id)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { api_key_encrypted: string; base_url: string } | null };
  conn = userConn;

  if (!conn?.api_key_encrypted) {
    const { data: orgConn } = (await from(supabase, 'api4com_connections' as never)
      .select('api_key_encrypted, base_url')
      .eq('org_id', call.org_id)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle()) as { data: { api_key_encrypted: string; base_url: string } | null };
    conn = orgConn;
  }

  if (!conn?.api_key_encrypted) return null;

  const apiKey = decrypt(conn.api_key_encrypted);
  const baseUrl = conn.base_url.replace(/\/$/, '');
  const api4comCallId = call.metadata?.api4com_call_id;

  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`${baseUrl}/calls?page=${page}`, {
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    });
    if (!response.ok) break;

    const data = (await response.json()) as Api4ComCallListResponse;
    const records = data.data ?? [];

    for (const record of records) {
      // Match by api4com_call_id (authoritative)
      if (api4comCallId && record.id === api4comCallId && record.record_url) {
        return record.record_url;
      }

      // Fallback: phone + timestamp + duration tolerance
      if (record.record_url) {
        const phoneKey = (record.to ?? '').replace(/\D/g, '').slice(-8);
        const fromKey = (record.from ?? '').replace(/\D/g, '').slice(-8);
        const destKey = call.destination.replace(/\D/g, '').slice(-8);
        const originKey = (call.origin ?? '').replace(/\D/g, '').slice(-4);
        const phoneMatch = phoneKey === destKey || (originKey.length >= 3 && fromKey.endsWith(originKey));

        if (phoneMatch) {
          const remoteDate = parseApi4ComTimestamp(record.started_at);
          const remoteTime = remoteDate ? remoteDate.getTime() : NaN;
          const localTime = new Date(call.started_at ?? call.created_at).getTime();
          const timeDiff = Math.abs(remoteTime - localTime);
          const durationMatch = record.duration > 0 && call.duration_seconds > 0
            ? Math.abs(record.duration - call.duration_seconds) /
                Math.max(record.duration, call.duration_seconds) < 0.3
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

async function tryDownloadAudio(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

export interface PersistRecordingResult {
  ok: boolean;
  path?: string;
  alreadyStored?: boolean;
  reason?: string;
}

/**
 * Download a call's recording and persist it to our private Storage bucket so
 * it stays playable after the API4COM listener link expires.
 *
 * Tries the stored `recording_url` first (still live for fresh calls); if that
 * is dead, re-resolves a durable URL via the API4COM API. On success the call
 * gets `recording_storage_path` set (and `recording_url` refreshed to the
 * durable URL when we had to re-resolve). Idempotent unless `force`.
 *
 * Service-role client expected (Storage write + RLS bypass).
 */
export async function persistCallRecording(
  supabase: SupabaseClient,
  callId: string,
  opts: { force?: boolean } = {},
): Promise<PersistRecordingResult> {
  const { data: call } = (await from(supabase, 'calls')
    .select(
      'id, org_id, recording_url, recording_storage_path, metadata, destination, started_at, created_at, user_id, origin, duration_seconds',
    )
    .eq('id', callId)
    .single()) as {
    data:
      | (CallForRecording & { recording_url: string | null; recording_storage_path: string | null })
      | null;
  };

  if (!call) return { ok: false, reason: 'call_not_found' };
  if (call.recording_storage_path && !opts.force) {
    return { ok: true, path: call.recording_storage_path, alreadyStored: true };
  }

  // 1) Try the stored URL (live for fresh calls), then a durable re-resolve.
  let buffer: Buffer | null = call.recording_url ? await tryDownloadAudio(call.recording_url) : null;

  if (!buffer) {
    const durable = await resolveApi4ComRecordingUrl(supabase, call);
    if (durable) {
      buffer = await tryDownloadAudio(durable);
      if (buffer && durable !== call.recording_url) {
        // Refresh the stored URL so other consumers (e.g. transcription) work too.
        await from(supabase, 'calls')
          .update({ recording_url: durable } as Record<string, unknown>)
          .eq('id', callId);
      }
    }
  }

  if (!buffer) return { ok: false, reason: 'no_audio_available' };

  // 2) Upload to the private bucket.
  const path = callRecordingStoragePath(call.org_id, call.id);
  const { error: uploadError } = await supabase.storage
    .from(CALL_RECORDINGS_BUCKET)
    .upload(path, buffer, { upsert: true, contentType: 'audio/mpeg' });

  if (uploadError) return { ok: false, reason: `upload_failed: ${uploadError.message}` };

  // 3) Record where it lives.
  await from(supabase, 'calls')
    .update({ recording_storage_path: path, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', callId);

  return { ok: true, path };
}
