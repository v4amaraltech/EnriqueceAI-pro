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
 * A call is permanently ineligible for transcription when its recording is
 * shorter than the minimum duration. Such calls are born `pending` (the column
 * default) but the eligibility query below filters them out (`duration >= MIN`),
 * so they never reach processCallTranscription's skip guard — leaving them stuck
 * at `pending` forever. This predicate lets the worker mark them `skipped`
 * itself, mirroring the service guard (reason `duration_too_short`).
 *
 * Note: a NULL duration is treated as "unknown / not yet finalized" — we leave
 * it alone so an in-flight call isn't skipped prematurely.
 */
export function isTooShortToTranscribe(durationSeconds: number | null): boolean {
  return durationSeconds !== null && durationSeconds < TRANSCRIPTION_MIN_DURATION_SECONDS;
}

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

  // Find calls eligible for transcription that haven't been processed yet.
  //
  // PostgREST's `.or('transcription_status.is.null,transcription_status.eq.pending')`
  // form silently dropped the IS NULL branch in production — for 3 V4 Amaral
  // calls stuck pending for 20+ hours the cron kept reporting
  // "No pending transcriptions". Split into two queries and merge so each
  // operator (`.is` vs `.eq`) runs through its proper code path.
  const results = await Promise.all([
    from(supabase, 'calls')
      .select('id, created_at')
      .not('recording_url', 'is', null)
      .gte('duration_seconds', TRANSCRIPTION_MIN_DURATION_SECONDS)
      .eq('transcription_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT),
    from(supabase, 'calls')
      .select('id, created_at')
      .not('recording_url', 'is', null)
      .gte('duration_seconds', TRANSCRIPTION_MIN_DURATION_SECONDS)
      .is('transcription_status', null)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT),
  ]);

  const pendingExplicit = (results[0] as { data: Array<{ id: string; created_at: string }> | null }).data ?? [];
  const pendingNull = (results[1] as { data: Array<{ id: string; created_at: string }> | null }).data ?? [];

  const calls = [...pendingExplicit, ...pendingNull]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, BATCH_LIMIT);

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

  // Drain calls that can never be transcribed because the recording is too
  // short. They are born `pending` (column default) but the eligibility query
  // above filters them out, so without this they pile up as a phantom backlog
  // forever. Mark them `skipped` exactly like processCallTranscription's guard.
  const skippedTooShort = await skipTooShortPending(supabase);

  return NextResponse.json({
    message: 'Pending transcriptions processed',
    total: calls.length,
    succeeded,
    failed,
    skippedTooShort,
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * Marks every `pending`/NULL call whose recording is too short as `skipped`.
 * Split into two statements (eq `pending` + is NULL) because PostgREST's
 * `.or('transcription_status.is.null,...')` form has historically dropped the
 * IS NULL branch in production. `.lt` naturally excludes NULL durations, so
 * calls whose duration isn't finalized yet are left untouched.
 */
async function skipTooShortPending(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<number> {
  const patch = {
    transcription_status: 'skipped',
    transcription_error: 'duration_too_short',
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>;

  const [explicit, nulls] = await Promise.all([
    from(supabase, 'calls')
      .update(patch)
      .lt('duration_seconds', TRANSCRIPTION_MIN_DURATION_SECONDS)
      .eq('transcription_status', 'pending')
      .select('id'),
    from(supabase, 'calls')
      .update(patch)
      .lt('duration_seconds', TRANSCRIPTION_MIN_DURATION_SECONDS)
      .is('transcription_status', null)
      .select('id'),
  ]);

  const explicitData = (explicit as { data: { id: string }[] | null }).data ?? [];
  const nullData = (nulls as { data: { id: string }[] | null }).data ?? [];
  return explicitData.length + nullData.length;
}

export async function GET(request: Request) {
  return POST(request);
}
