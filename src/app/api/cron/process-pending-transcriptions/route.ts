import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { processCallTranscription } from '@/features/calls/services/transcription.service';
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '@/features/calls/schemas/call.schemas';

export const maxDuration = 300; // 5 min — sequential processing
const BATCH_LIMIT = 10;

/**
 * Catches calls that have a recording_url + sufficient duration but never got
 * transcribed (e.g. webhook arrived without recordUrl, app was deploying, etc).
 *
 * Runs periodically — picks up to BATCH_LIMIT pending calls and processes each
 * sequentially via the same processCallTranscription used by the on-demand worker.
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Find calls eligible for transcription that haven't been processed yet
  const { data: pending } = (await from(supabase, 'calls')
    .select('id')
    .not('recording_url', 'is', null)
    .gte('duration_seconds', TRANSCRIPTION_MIN_DURATION_SECONDS)
    .or('transcription_status.is.null,transcription_status.eq.pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)) as { data: { id: string }[] | null };

  const calls = pending ?? [];

  if (calls.length === 0) {
    return NextResponse.json({ message: 'No pending transcriptions', processed: 0 });
  }

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const call of calls) {
    try {
      await processCallTranscription(call.id);
      succeeded++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : 'unknown';
      errors.push(`${call.id}: ${msg}`);
    }
  }

  return NextResponse.json({
    message: 'Pending transcriptions processed',
    total: calls.length,
    succeeded,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
