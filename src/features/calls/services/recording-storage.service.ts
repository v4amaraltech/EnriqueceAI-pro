import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { lookupRecordingFromApi4Com } from './recover-recording.service';

export const CALL_RECORDINGS_BUCKET = 'call-recordings';

/** Storage object path for a call's recording: `{org_id}/{call_id}.mp3`. */
export function callRecordingStoragePath(orgId: string, callId: string): string {
  return `${orgId}/${callId}.mp3`;
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
      | {
          id: string;
          org_id: string;
          recording_url: string | null;
          recording_storage_path: string | null;
          metadata: Record<string, string> | null;
          destination: string;
          started_at: string | null;
          created_at: string;
          user_id: string;
          origin: string | null;
          duration_seconds: number;
        }
      | null;
  };

  if (!call) return { ok: false, reason: 'call_not_found' };
  if (call.recording_storage_path && !opts.force) {
    return { ok: true, path: call.recording_storage_path, alreadyStored: true };
  }

  // 1) Try the stored URL (live for fresh calls), then a durable re-resolve.
  let buffer: Buffer | null = call.recording_url ? await tryDownloadAudio(call.recording_url) : null;

  if (!buffer) {
    const durable = await lookupRecordingFromApi4Com(supabase, call);
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
