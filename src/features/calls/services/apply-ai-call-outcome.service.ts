import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { AI_OUTCOME_REVIEW_CONFIDENCE, readAiOutcome, type AiOutcome } from '../ai-outcome';
import { applySdrCallResult } from './apply-sdr-call-result';
import { mergeCallsMetadata } from './merge-calls-metadata';
import { classifyCallOutcome, type CallOutcomeClassification, type CallOutcomeInput } from './call-outcome-classifier';
import { loadPendingReturns, pauseCadencesUntilReturn, scheduleCallbackActivity, type PendingReturn } from './schedule-callback.service';

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

/** Grava `metadata.ai_outcome` por merge atômico no banco (só a chave ai_outcome). */
async function writeAiOutcome(supabase: SupabaseClient, callId: string, outcome: AiOutcome): Promise<void> {
  const { error } = await mergeCallsMetadata(supabase, callId, { ai_outcome: outcome });
  if (error) console.error(`[ai-outcome] falha ao gravar ai_outcome da ligação ${callId}: ${error}`);
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
 * Qual retorno pendente vale mais que o da IA (`null` = a IA agenda como sempre):
 *  - marcado depois do início desta ligação: o SDR já decidiu para esta conversa, mesmo que a IA tenha ouvido um horário;
 *  - ainda por vencer e a IA NÃO ouviu data/hora (usaria o padrão): fica o combinado.
 */
export function returnToKeep(
  pending: readonly PendingReturn[],
  input: { timeFromLead: boolean; callStartedAt: string; now: Date },
): PendingReturn | null {
  const newestFirst = [...pending].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const duringCall = newestFirst.find((r) => Date.parse(r.created_at) >= Date.parse(input.callStartedAt));
  if (duringCall) return duringCall;
  if (input.timeFromLead) return null;
  return newestFirst.find((r) => Date.parse(r.scheduled_at) > input.now.getTime()) ?? null;
}

/**
 * Se a ligação espera o resultado da IA (`ai_outcome.status = 'pending'`),
 * classifica a transcrição e aplica:
 *  - `sdr_disposition` (só se o SDR ainda não marcou nada);
 *  - `notes` = resumo da IA + anotação do SDR;
 *  - `callback_requested` → retorno por telefone agendado, salvo se já houver um que vale mais (`returnToKeep`);
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
  const pendingOutcome = readAiOutcome(state?.metadata);
  if (pendingOutcome?.status !== 'pending') return null;
  // Só ligações armadas pelo cockpit carregam o marcador; as demais seguem como antes.
  const holdLowConfidence = pendingOutcome.hold_low_confidence === true;

  const startedAt = now().toISOString();
  // Claim atômico: só quem mudar `pending` para `processing` segue. A guarda roda
  // dentro do mesmo UPDATE do merge (merge_calls_metadata).
  const claim = await mergeCallsMetadata(
    supabase,
    call.id,
    { ai_outcome: { status: 'processing', started_at: startedAt } },
    { onlyIfAiOutcomeStatus: 'pending' },
  );
  if (claim.error) console.error(`[ai-outcome] claim falhou para a ligação ${call.id}: ${claim.error}`);
  if (!claim.updated) return null;

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

  // Baixa confiança no cockpit: não aplica nada, só guarda a sugestão para revisão humana.
  if (holdLowConfidence && result.confidence < AI_OUTCOME_REVIEW_CONFIDENCE) {
    const held: AiOutcome = {
      status: 'done',
      disposition: result.disposition,
      confidence: result.confidence,
      summary: result.summary,
      callback_at: result.callback_at,
      scheduled_activity_id: null,
      model: result.model,
      needs_review: true,
      applied: false,
      classified_at: now().toISOString(),
    };
    await writeAiOutcome(supabase, call.id, held);
    return held;
  }

  let needsReview = result.needs_review;
  let error: string | null = null;

  // Leitura fresca ANTES de aplicar: a classificação leva segundos e o SDR pode ter marcado o desfecho (e o retorno
  // dele) nesse meio tempo. Depois do `applySdrCallResult` a coluna já traz o desfecho da própria IA, então não dá mais
  // para saber quem marcou.
  // A mesma leitura fresca vale para a anotação: o SDR pode ter escrito nela enquanto a IA classificava.
  const fresh = (await readCallState(supabase, call.id)) ?? state;
  const sdrAlreadyMarked = Boolean(state?.sdr_disposition || fresh?.sdr_disposition);

  const applied = await applySdrCallResult(supabase, {
    orgId: call.org_id,
    userId: call.user_id ?? '',
    callId: call.id,
    // Nunca sobrescreve o que o SDR marcou.
    sdrOutcome: sdrAlreadyMarked ? undefined : result.disposition,
    clientDurationSeconds: 0,
    notes: composeAiNotes(result.summary, fresh?.notes ?? null),
    leadId: call.lead_id ?? undefined,
    via: 'power_dialer',
  });
  if (!applied.success) {
    needsReview = true;
    error = `apply_failed: ${applied.error}`;
  }

  let scheduledActivityId: string | null = null;
  let callbackAt = result.callback_at;
  if (result.disposition === 'callback_requested' && result.callback_at && sdrAlreadyMarked) {
    // O SDR já registrou o desfecho (e o retorno dele): agendar aqui cancelaria o horário que ele marcou.
    console.warn(`[ai-outcome] ligação ${call.id}: o SDR já marcou o desfecho; retorno da IA não agendado`);
  } else if (result.disposition === 'callback_requested' && result.callback_at) {
    if (call.lead_id && call.user_id) {
      try {
        const pending = await loadPendingReturns(supabase, call.org_id, call.lead_id);
        // Sem saber o que já está marcado, não cria nem cancela: fica para o SDR revisar.
        if (!pending) throw new Error('callback_existing_check_failed');
        const keep = returnToKeep(pending, {
          timeFromLead: result.callback_time_from_lead,
          callStartedAt: call.started_at ?? call.created_at,
          now: now(),
        });
        if (keep) {
          scheduledActivityId = keep.id;
          callbackAt = keep.scheduled_at;
          console.warn(`[ai-outcome] ligação ${call.id}: mantido o retorno já marcado; a IA não reagendou`);
          // Cadência ativa apesar do retorno futuro: pausa até o dia útil seguinte ao retorno que ficou.
          if (Date.parse(keep.scheduled_at) > now().getTime()) {
            await pauseCadencesUntilReturn(supabase, {
              orgId: call.org_id,
              leadId: call.lead_id,
              userId: call.user_id,
              scheduledAt: keep.scheduled_at,
              scheduledActivityId: keep.id,
            });
          }
        } else {
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
        }
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
    callback_at: callbackAt,
    scheduled_activity_id: scheduledActivityId,
    model: result.model,
    needs_review: needsReview,
    classified_at: now().toISOString(),
    ...(error ? { error: error.slice(0, 300) } : {}),
  };
  await writeAiOutcome(supabase, call.id, outcome);
  return outcome;
}
