import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { readAiOutcome } from '@/features/calls/ai-outcome';

import type { CockpitCallOutcomeResult } from '../types';
import { buildCallOutcomeView, type CallOutcomeRow } from '../utils/call-outcome-view';

export interface OutcomeActor {
  orgId: string;
  userId: string;
  isManager: boolean;
}

export interface CallAccessRow extends CallOutcomeRow {
  id: string;
  destination?: string | null;
  started_at?: string | null;
  user_id: string | null;
  lead_id: string | null;
}

const CALL_COLUMNS =
  'id, user_id, lead_id, destination, started_at, answered_at, hangup_cause, duration_seconds, sdr_disposition, notes, transcription_status, metadata';

/**
 * Lê a ligação dentro da organização e confere a permissão: gestor lê qualquer
 * uma; SDR e closer só as próprias ou de leads da própria carteira.
 */
export async function loadAccessibleCall(
  supabase: SupabaseClient,
  actor: OutcomeActor,
  callId: string,
): Promise<{ call: CallAccessRow } | { error: string } | null> {
  const { data, error } = (await from(supabase, 'calls')
    .select(CALL_COLUMNS)
    .eq('id', callId)
    .eq('org_id', actor.orgId)
    .maybeSingle()) as { data: CallAccessRow | null; error: { message: string } | null };

  if (error) {
    console.error('[cockpit-outcome] calls:', error.message);
    return { error: 'Falha ao carregar o resultado da ligação' };
  }
  if (!data) return null;
  if (actor.isManager || data.user_id === actor.userId) return { call: data };

  if (data.lead_id) {
    const { data: lead } = (await from(supabase, 'leads')
      .select('assigned_to, closer_id')
      .eq('id', data.lead_id)
      .eq('org_id', actor.orgId)
      .maybeSingle()) as { data: { assigned_to: string | null; closer_id: string | null } | null };
    if (lead && (lead.assigned_to === actor.userId || lead.closer_id === actor.userId)) return { call: data };
  }
  return null;
}

/** Estado do resultado da ligação para o cartão. SOMENTE LEITURA, idempotente. */
export async function fetchCockpitCallOutcome(
  supabase: SupabaseClient,
  actor: OutcomeActor,
  callId: string,
): Promise<CockpitCallOutcomeResult> {
  const loaded = await loadAccessibleCall(supabase, actor, callId);
  if (!loaded) return { status: 'not_found' };
  if ('error' in loaded) return { status: 'error', error: loaded.error };
  return { status: 'ok', outcome: buildCallOutcomeView(loaded.call) };
}

/**
 * Arma a ligação para receber resultado automático: grava
 * `metadata.ai_outcome = { status: 'pending', hold_low_confidence: true }`.
 * O webhook, a transcrição e o cron existentes fazem o resto. Idempotente:
 * se já existe qualquer `ai_outcome` (pendente, feito ou falho) não escreve de novo.
 * Nunca dispara ligação, transcrição nem mensagem.
 */
export async function armCockpitCallOutcome(
  supabase: SupabaseClient,
  actor: OutcomeActor,
  callId: string,
  now: Date = new Date(),
): Promise<{ status: 'armed' | 'already_armed' | 'not_found' | 'error' }> {
  const loaded = await loadAccessibleCall(supabase, actor, callId);
  if (!loaded) return { status: 'not_found' };
  if ('error' in loaded) return { status: 'error' };

  const { call } = loaded;
  // Resultado humano já registrado ou IA já respondeu/trabalhando: não rearmar.
  if (readAiOutcome(call.metadata) || call.sdr_disposition) return { status: 'already_armed' };

  const { error } = (await from(supabase, 'calls')
    .update({
      metadata: {
        ...(call.metadata ?? {}),
        ai_outcome: { status: 'pending', requested_at: now.toISOString(), hold_low_confidence: true },
      },
      updated_at: now.toISOString(),
    } as Record<string, unknown>)
    .eq('id', callId)
    .eq('org_id', actor.orgId)) as { error: { message: string } | null };

  if (error) {
    console.error('[cockpit-outcome] arm:', error.message);
    return { status: 'error' };
  }
  return { status: 'armed' };
}
