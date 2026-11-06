import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { readAiOutcome, type AiOutcome } from '../ai-outcome';
import { applySdrCallResult } from './apply-sdr-call-result';
import { classifyCallOutcome, type CallOutcomeClassification, type CallOutcomeInput } from './call-outcome-classifier';
import { scheduleCallbackActivity } from './schedule-callback.service';

export interface AiOutcomeCall {
  id: string;
  org_id: string;
  lead_id: string | null;
  user_id: string | null;
  duration_seconds: number;
  started_at: string | null;
  created_at: string;
}

export interface ApplyAiCallOutcomeDeps {
  classify?: (input: CallOutcomeInput, now: Date) => Promise<CallOutcomeClassification>;
  now?: () => Date;
}

interface CallState {
  metadata: Record<string, unknown> | null;
  notes: string | null;
  sdr_disposition: string | null;
}

async function readCallState(supabase: SupabaseClient, callId: string): Promise<CallState | null> {
  const { data } = (await from(supabase, 'calls')
    .select('metadata, notes, sdr_disposition')
    .eq('id', callId)
    .single()) as { data: CallState | null };
  return data;
}

/** Grava `metadata.ai_outcome` sem perder o resto do metadata (lido na hora). */
async function writeAiOutcome(supabase: SupabaseClient, callId: string, outcome: AiOutcome): Promise<void> {
  const state = await readCallState(supabase, callId);
  await from(supabase, 'calls')
    .update({
      metadata: { ...(state?.metadata ?? {}), ai_outcome: outcome },
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', callId);
}

/** Marca a classificação como falha (fica com o selo "Revisar"). */
export async function markAiOutcomeFailed(supabase: SupabaseClient, callId: string, error: string): Promise<void> {
  await writeAiOutcome(supabase, callId, {
    status: 'failed',
    needs_review: true,
    error: error.slice(0, 300),
    classified_at: new Date().toISOString(),
  });
}

/** Junta o resumo da IA com o que o SDR já tinha anotado. */
export function composeAiNotes(summary: string, sdrNotes: string | null): string {
  const base = `Resumo da IA: ${summary}`;
  const existing = sdrNotes?.trim();
  return existing ? `${base}\n\nAnotação do SDR: ${existing}` : base;
}

/**
 * Se a ligação espera o resultado da IA (`ai_outcome.status = 'pending'`),
 * classifica a transcrição e aplica:
 *  - `sdr_disposition` (só se o SDR ainda não marcou nada);
 *  - `notes` = resumo da IA + anotação do SDR;
 *  - `callback_requested` → retorno por telefone agendado;
 *  - `metadata.ai_outcome = { status: 'done', ... }` (ou `failed` + Revisar).
 *
 * Trava contra rodar 2x (webhook + cron): só segue quem conseguir mudar o
 * status de `pending` para `processing`.
 */
export async function applyAiCallOutcome(
  supabase: SupabaseClient,
  call: AiOutcomeCall,
  transcription: string,
  deps: ApplyAiCallOutcomeDeps = {},
): Promise<AiOutcome | null> {
  const classify = deps.classify ?? classifyCallOutcome;
  const now = deps.now ?? (() => new Date());

  const state = await readCallState(supabase, call.id);
  if (readAiOutcome(state?.metadata)?.status !== 'pending') return null;

  const startedAt = now().toISOString();
  const { data: claimed } = (await from(supabase, 'calls')
    .update({
      metadata: { ...(state?.metadata ?? {}), ai_outcome: { status: 'processing', started_at: startedAt } },
    } as Record<string, unknown>)
    .eq('id', call.id)
    .eq('metadata->ai_outcome->>status', 'pending')
    .select('id')) as { data: { id: string }[] | null };
  if (!claimed || claimed.length === 0) return null;

  let result: CallOutcomeClassification;
  try {
    result = await classify(
      {
        transcription,
        durationSeconds: call.duration_seconds,
        calledAt: new Date(call.started_at ?? call.created_at),
      },
      now(),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-outcome] classificação falhou para a ligação ${call.id}: ${msg}`);
    await markAiOutcomeFailed(supabase, call.id, msg);
    return { status: 'failed', needs_review: true, error: msg };
  }

  let needsReview = result.needs_review;
  let error: string | null = null;

  const applied = await applySdrCallResult(supabase, {
    orgId: call.org_id,
    userId: call.user_id ?? '',
    callId: call.id,
    // Nunca sobrescreve o que o SDR marcou.
    sdrOutcome: state?.sdr_disposition ? undefined : result.disposition,
    clientDurationSeconds: 0,
    notes: composeAiNotes(result.summary, state?.notes ?? null),
    leadId: call.lead_id ?? undefined,
    via: 'power_dialer',
  });
  if (!applied.success) {
    needsReview = true;
    error = `apply_failed: ${applied.error}`;
  }

  let scheduledActivityId: string | null = null;
  if (result.disposition === 'callback_requested' && result.callback_at) {
    if (call.lead_id && call.user_id) {
      try {
        const scheduled = await scheduleCallbackActivity(supabase, {
          orgId: call.org_id,
          leadId: call.lead_id,
          userId: call.user_id,
          scheduledAt: result.callback_at,
          notes: result.callback_time_from_lead
            ? 'Retorno pedido pelo lead (identificado pela IA)'
            : 'Lead pediu retorno sem horário — agendado para o próximo dia útil 9h (IA)',
        });
        scheduledActivityId = scheduled.id;
      } catch (err) {
        needsReview = true;
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      needsReview = true;
      error = 'callback_without_lead_or_user';
    }
  }

  const outcome: AiOutcome = {
    status: 'done',
    disposition: result.disposition,
    confidence: result.confidence,
    summary: result.summary,
    callback_at: result.callback_at,
    scheduled_activity_id: scheduledActivityId,
    model: result.model,
    needs_review: needsReview,
    classified_at: now().toISOString(),
    ...(error ? { error: error.slice(0, 300) } : {}),
  };
  await writeAiOutcome(supabase, call.id, outcome);
  return outcome;
}
