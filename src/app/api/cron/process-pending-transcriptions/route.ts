import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { processCallTranscription } from '@/features/calls/services/transcription.service';
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '@/features/calls/schemas/call.schemas';
import { AI_OUTCOME_MIN_DURATION_SECONDS, transcriptionMinDurationFor } from '@/features/calls/ai-outcome';
import { markAiOutcomeFailed } from '@/features/calls/services/apply-ai-call-outcome.service';

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
export function isTooShortToTranscribe(durationSeconds: number | null, metadata?: unknown): boolean {
  return durationSeconds !== null && durationSeconds < transcriptionMinDurationFor(metadata);
}

/** Janela em que o cron procura ligações com `ai_outcome` pendente. */
const AI_OUTCOME_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/** Depois disso, `ai_outcome` pendente sem áudio utilizável vira `failed` (Revisar). */
export const AI_OUTCOME_EXPIRE_AFTER_MS = 2 * 60 * 60 * 1000;
/** `processing` parado há mais que isso = execução que morreu no meio. */
const AI_OUTCOME_STUCK_AFTER_MS = 30 * 60 * 1000;

interface AiPendingRow {
  id: string;
  created_at: string;
  recording_url: string | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Motivo para desistir de uma ligação que espera o resultado da IA, ou `null`
 * se ainda vale esperar. Só expira depois de `AI_OUTCOME_EXPIRE_AFTER_MS`
 * (gravação pode chegar atrasada pela recuperação).
 */
export function aiOutcomeExpiryReason(
  row: Pick<AiPendingRow, 'created_at' | 'recording_url' | 'duration_seconds' | 'metadata'>,
  now: Date,
): string | null {
  const meta = row.metadata as { ai_outcome?: { status?: string; started_at?: string } } | null;
  const status = meta?.ai_outcome?.status;
  if (status === 'processing') {
    const startedAt = meta?.ai_outcome?.started_at ? new Date(meta.ai_outcome.started_at).getTime() : 0;
    return now.getTime() - startedAt > AI_OUTCOME_STUCK_AFTER_MS ? 'processing_stuck' : null;
  }
  if (status !== 'pending') return null;
  if (now.getTime() - new Date(row.created_at).getTime() < AI_OUTCOME_EXPIRE_AFTER_MS) return null;
  if (!row.recording_url) return 'no_recording';
  if ((row.duration_seconds ?? 0) < AI_OUTCOME_MIN_DURATION_SECONDS) return 'duration_too_short';
  return null;
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

  // Ligações do Power Dialer esperando o resultado da IA (piso de 10 s). Pega
  // QUALQUER transcription_status (exceto processing): o `pending` pode ter
  // sido gravado depois do hangup, quando a ligação já tinha virado `skipped`
  // (duration_too_short) ou até `completed` (≥ 5 min) — o service trata cada caso.
  const aiPendingCalls = await fetchAiOutcomeCalls(supabase);
  const aiEligible = aiPendingCalls.filter(
    (c) =>
      (c.metadata as { ai_outcome?: { status?: string } } | null)?.ai_outcome?.status === 'pending' &&
      !!c.recording_url &&
      (c.duration_seconds ?? 0) >= AI_OUTCOME_MIN_DURATION_SECONDS,
  );

  const seen = new Set<string>();
  const calls = [
    ...aiEligible.slice(0, BATCH_LIMIT),
    ...[...pendingExplicit, ...pendingNull].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  ]
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
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

  // `ai_outcome` que nunca vai ter áudio (sem gravação / < 10 s) ou que travou
  // em `processing` → `failed` + Revisar, para não ficar pendente para sempre.
  const now = new Date();
  let aiExpired = 0;
  for (const row of aiPendingCalls) {
    const reason = aiOutcomeExpiryReason(row, now);
    if (!reason) continue;
    await markAiOutcomeFailed(supabase, row.id, reason);
    aiExpired++;
  }

  return NextResponse.json({
    message: 'Pending transcriptions processed',
    total: calls.length,
    succeeded,
    failed,
    skippedTooShort,
    aiOutcomePending: aiEligible.length,
    aiExpired,
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

/** Ligações recentes com `ai_outcome` `pending` ou `processing`. */
async function fetchAiOutcomeCalls(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<AiPendingRow[]> {
  const since = new Date(Date.now() - AI_OUTCOME_LOOKBACK_MS).toISOString();
  const { data } = (await from(supabase, 'calls')
    .select('id, created_at, recording_url, duration_seconds, metadata')
    .in('metadata->ai_outcome->>status', ['pending', 'processing'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(50)) as { data: AiPendingRow[] | null };
  return data ?? [];
}

export async function GET(request: Request) {
  return POST(request);
}
