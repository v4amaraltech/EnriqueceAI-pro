'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { getAppUrl } from '@/lib/utils/app-url';

import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '../schemas/call.schemas';
import { lookupRecordingFromApi4Com } from '../services/recover-recording.service';

const callIdSchema = z.string().uuid('ID inválido');

/**
 * Fetch a durable recording URL from API4COM for a call that has no recording
 * stored locally. Matching (by api4com_call_id or phone+timestamp) lives in
 * resolveApi4ComRecordingUrl, shared with the Storage persistence service.
 */
export async function fetchCallRecording(
  callId: string,
): Promise<ActionResult<{ recording_url: string | null }>> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // 1. Get the call
  const { data: call } = (await from(supabase, 'calls')
    .select('id, org_id, recording_url, metadata, destination, started_at, created_at, user_id, origin, duration_seconds')
    .eq('id', callId)
    .single()) as {
    data: {
      id: string;
      org_id: string;
      recording_url: string | null;
      metadata: Record<string, string> | null;
      destination: string;
      started_at: string | null;
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

  // 2. Resolve a durable URL from the API4COM API
  const recordingUrl = await lookupRecordingFromApi4Com(supabase, call);

  // 3. Update local call if we found a recording
  if (recordingUrl) {
    await from(supabase, 'calls')
      .update({ recording_url: recordingUrl, updated_at: new Date().toISOString() })
      .eq('id', callId);

    // Trigger transcription if duration meets minimum
    if (call.duration_seconds >= TRANSCRIPTION_MIN_DURATION_SECONDS) {
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
