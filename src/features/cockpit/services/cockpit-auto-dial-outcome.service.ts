import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { applySdrCallResult } from '@/features/calls/services/apply-sdr-call-result';
import type { CallDisposition } from '@/features/calls/types';

import type { AutoDialAnsweredClassification, AutoDialCarrierHangup, AutoDialConcludeResult, AutoDialNoAnswerResult } from '../auto-dial.types';
import { extractAmd, extractAutoHangup, getAnsweredVerdict, type AnsweredVerdict } from '../utils/answered-verdict';
import { AUTO_DIAL_RULES, isLastAttemptOfDay, type AutoDialRules } from '../utils/auto-dial-rules';
import { dispositionForExternalConclusion, type ExternalConclusionKind } from '../utils/external-conclusion';
import { buildNoAnswerNote } from '../utils/no-answer-note';
import { AUTO_DIAL_METADATA_KEY, loadLeadCallStats } from './cockpit-auto-dial.service';

/**
 * Desfecho das ligações do motor. NUNCA chama `completeDialerCall` (ele avança a cadência; o Cockpit não, D6).
 * Grava só `calls.sdr_disposition`/notas por `applySdrCallResult`; `calls.status` é da telefonia (NFR-5).
 * Só mexe em ligação do PRÓPRIO usuário (a posse nunca é relaxada) e que seja do motor: marcada com
 * `metadata.cockpit_auto_dial` OU criada há pouco (`OWN_CALL_GRACE_MS`), para o caso de o marcador ter falhado depois de a
 * ligação já ter sido feita (o motor nunca trava o lead por isso).
 * Depois de gravar, RELÊ `calls.sdr_disposition`: `applySdrCallResult` ignora erro do update e não pode dizer que gravou sem gravar.
 */

/** Janela em que a ligação do próprio usuário vale mesmo sem o marcador do motor. */
export const OWN_CALL_GRACE_MS = 30 * 60_000;
/** "Não foi conversa" (vindo do navegador) só vale para ligação criada há menos disto. */
export const NOT_CONVERSATION_MAX_AGE_MS = 30 * 60_000;

/** O desfecho esperado ficou mesmo em `calls.sdr_disposition`? */
async function dispositionWasWritten(supabase: SupabaseClient, orgId: string, callId: string, expected: string): Promise<boolean> {
  const { data, error } = (await from(supabase, 'calls')
    .select('sdr_disposition')
    .eq('id', callId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { sdr_disposition: string | null } | null; error: { message: string } | null };
  return !error && data?.sdr_disposition === expected;
}

interface MotorCallRow {
  id: string;
  user_id: string | null;
  lead_id: string | null;
  answered_at: string | null;
  duration_seconds: number | null;
  hangup_cause: string | null;
  sdr_disposition: string | null;
  notes: string | null;
  created_at: string | null;
  started_at: string | null;
  metadata: Record<string, unknown> | null;
}

async function loadMotorCall(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  callId: string,
): Promise<MotorCallRow | null | 'error'> {
  const { data, error } = (await from(supabase, 'calls')
    .select('id, user_id, lead_id, answered_at, duration_seconds, hangup_cause, sdr_disposition, notes, created_at, started_at, metadata')
    .eq('id', callId)
    .eq('org_id', orgId)
    .maybeSingle()) as { data: MotorCallRow | null; error: { message: string } | null };
  if (error) return 'error';
  if (!data || data.user_id !== userId) return null;
  const marked = data.metadata != null && data.metadata[AUTO_DIAL_METADATA_KEY] != null;
  const createdAt = data.created_at ? Date.parse(data.created_at) : Number.NaN;
  const recent = Number.isFinite(createdAt) && Date.now() - createdAt <= OWN_CALL_GRACE_MS;
  return marked || recent ? data : null;
}

/** Veredito "conversou?" a partir da linha da ligação (answered_at, duração e a previsão da escuta ao vivo). */
function verdictOfCall(call: MotorCallRow): AnsweredVerdict {
  const amd = extractAmd(call.metadata);
  return getAnsweredVerdict({
    answeredAt: call.answered_at,
    durationSeconds: call.duration_seconds,
    amdPrediction: amd?.prediction ?? null,
    amdConfidence: amd?.confidence ?? null,
  });
}

/** Desfecho de uma atendida-por-máquina na última tentativa: caixa postal só se a escuta disse isso com confiança. */
function machineDisposition(call: MotorCallRow, verdict: AnsweredVerdict | null): 'voicemail' | 'no_answer' {
  const prediction = extractAmd(call.metadata)?.prediction;
  return verdict?.reason === 'machine' && (prediction === 'voicemail' || prediction === 'number_not_exist') ? 'voicemail' : 'no_answer';
}

/** A escuta ao vivo desligou a ligação do motor (marca `live_amd.auto_hangup`)? Só ligação do PRÓPRIO usuário e do motor. */
export async function readMotorCarrierHangup(input: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  callId: string;
}): Promise<AutoDialCarrierHangup | { status: 'error' }> {
  try {
    const call = await loadMotorCall(input.supabase, input.orgId, input.userId, input.callId);
    if (call === 'error') return { status: 'error' };
    if (!call || !call.lead_id) return { status: 'refused' };
    const mark = extractAutoHangup(call.metadata);
    return mark ? { status: 'auto_hangup', prediction: mark.prediction } : { status: 'none' };
  } catch (err) {
    console.error('[cockpit-auto-dial] auto_hangup:', err instanceof Error ? err.message : 'erro');
    return { status: 'error' };
  }
}

/**
 * PR-B: uma ligação ATENDIDA (answered_at) CONVERSOU? Só quem conversou mostra as três ações ao SDR; máquina, caixa
 * postal e atendida curtíssima voltam para a fila. Sinal claro (máquina com confiança ou humano) decide na hora; senão
 * espera a duração fechar (hangup_cause). O chamador faz fail-open (conversou) se o sinal não chegar a tempo.
 */
export async function classifyMotorAnsweredCall(input: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  callId: string;
}): Promise<AutoDialAnsweredClassification | { status: 'error' }> {
  try {
    const call = await loadMotorCall(input.supabase, input.orgId, input.userId, input.callId);
    if (call === 'error') return { status: 'error' };
    if (!call || !call.lead_id) return { status: 'refused' };
    const v = verdictOfCall(call);
    const decisive = v.reason === 'machine' || v.reason === 'human' || v.reason === 'not_answered';
    if (!decisive && !call.hangup_cause) return { status: 'pending' };
    return { status: 'verdict', verdict: v.verdict, reason: v.reason, machine: v.reason === 'machine' };
  } catch (err) {
    console.error('[cockpit-auto-dial] classify:', err instanceof Error ? err.message : 'erro');
    return { status: 'error' };
  }
}

/**
 * FR-6/FR-7: ligação do motor terminou SEM atendimento (`hangup_cause` preenchido e `answered_at` nulo).
 * Só na ÚLTIMA tentativa do dia (3ª, contando qualquer origem) grava `no_answer`; na 1ª e 2ª não grava nada
 * e a cadência não avança. `pending` = a operadora ainda não confirmou.
 */
export async function resolveMotorNoAnswer(input: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  callId: string;
  now: Date;
  rules?: AutoDialRules;
  countClient?: SupabaseClient;
  /** O SDR (ou o veredito) disse que NÃO foi conversa: a atendida é tratada como não atendida. */
  notConversation?: boolean;
}): Promise<AutoDialNoAnswerResult | { status: 'error' }> {
  const { supabase, orgId, userId, callId, now } = input;
  const rules = input.rules ?? AUTO_DIAL_RULES;
  try {
    const call = await loadMotorCall(supabase, orgId, userId, callId);
    if (call === 'error') return { status: 'error' };
    if (!call || !call.lead_id) return { status: 'refused' };
    // Atendida: só segue como não atendida se NÃO conversou (máquina, caixa postal, curtíssima) ou se o SDR disse que não foi conversa.
    const verdict = call.answered_at ? verdictOfCall(call) : null;
    // O "Não foi conversa" vem do navegador: só vale para ligação recente (nunca reabre uma antiga).
    const createdMs = call.created_at ? Date.parse(call.created_at) : Number.NaN;
    const notConversation = Boolean(input.notConversation) && Number.isFinite(createdMs) && now.getTime() - createdMs <= NOT_CONVERSATION_MAX_AGE_MS;
    if (call.answered_at && !notConversation && verdict?.verdict !== 'nao_conversou') return { status: 'answered' };
    // Atendida que JÁ tem desfecho (Agendar, Confirmar...): nunca sobrescreve (applySdrCallResult grava sem guarda).
    if (call.answered_at && call.sdr_disposition) return { status: 'answered' };
    if (!call.hangup_cause) return { status: 'pending' };

    const stats = await loadLeadCallStats(input.countClient ?? createServiceRoleClient(), orgId, call.lead_id, now);
    if (!stats) return { status: 'error' };
    const attemptNo = stats.callsToday;
    if (!isLastAttemptOfDay(attemptNo, rules)) return { status: 'not_last', attemptNo };

    // A-D9 / FR-25: nota padrão. Vai pelo MESMO `applySdrCallResult` que já grava o `no_answer` (campo `calls.notes`,
    // espelhado na interação da ligação), e só quando a ligação ainda não tem nota (nunca cobre texto do SDR).
    const note = call.notes?.trim() ? undefined : buildNoAnswerNote(call.started_at ?? call.created_at ?? now, attemptNo, rules.maxAttemptsPerDay);
    const disposition = call.answered_at ? machineDisposition(call, verdict) : 'no_answer';
    const written = await applySdrCallResult(supabase, {
      orgId,
      userId,
      callId,
      sdrOutcome: disposition,
      clientDurationSeconds: 0,
      ...(note ? { notes: note } : {}),
      via: 'webphone',
    });
    if (!written.success || !(await dispositionWasWritten(supabase, orgId, callId, disposition))) return { status: 'error' };
    return { status: 'recorded', attemptNo };
  } catch (err) {
    console.error('[cockpit-auto-dial] no-answer:', err instanceof Error ? err.message : 'erro');
    return { status: 'error' };
  }
}

/**
 * FR-9: o SDR confirma (ou troca) o desfecho. Sobrescreve o que a IA tiver gravado e NÃO avança a cadência.
 * O clique é o que libera o motor, mesmo com a IA de confiança alta (C-5); pode vir antes da IA terminar (C-4).
 */
export async function confirmMotorOutcome(input: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  callId: string;
  disposition: CallDisposition;
  notes?: string;
}): Promise<{ status: 'confirmed' | 'refused' | 'error' }> {
  const { supabase, orgId, userId, callId } = input;
  try {
    const call = await loadMotorCall(supabase, orgId, userId, callId);
    if (call === 'error') return { status: 'error' };
    if (!call) return { status: 'refused' };
    const written = await applySdrCallResult(supabase, {
      orgId,
      userId,
      callId,
      sdrOutcome: input.disposition,
      clientDurationSeconds: 0,
      ...(input.notes ? { notes: input.notes } : {}),
      via: 'webphone',
    });
    if (!written.success || !(await dispositionWasWritten(supabase, orgId, callId, input.disposition))) return { status: 'error' };
    return { status: 'confirmed' };
  } catch (err) {
    console.error('[cockpit-auto-dial] confirm:', err instanceof Error ? err.message : 'erro');
    return { status: 'error' };
  }
}

/**
 * O SDR concluiu o lead pelo painel (Agendar reunião / Desqualificar) durante a ligação do motor. O painel já grava
 * o que é do lead; aqui só se dá à LIGAÇÃO um desfecho, para ela não ficar pendente (decisão do usuário: vale como
 * desfecho, sem pedir o Confirmar). Não avança cadência (nunca `completeDialerCall`). `pending` = a operadora ainda
 * não disse se atendeu; o chamador tenta de novo. O valor vem de `dispositionForExternalConclusion`.
 */
export async function concludeMotorCallExternally(input: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  callId: string;
  kind: ExternalConclusionKind;
}): Promise<AutoDialConcludeResult | { status: 'error' }> {
  const { supabase, orgId, userId, callId, kind } = input;
  try {
    const call = await loadMotorCall(supabase, orgId, userId, callId);
    if (call === 'error') return { status: 'error' };
    if (!call) return { status: 'refused' };
    const answered = call.answered_at != null;
    if (!answered && !call.hangup_cause) return { status: 'pending' };

    const disposition = dispositionForExternalConclusion(kind, answered);
    const written = await applySdrCallResult(supabase, {
      orgId,
      userId,
      callId,
      sdrOutcome: disposition,
      clientDurationSeconds: 0,
      via: 'webphone',
    });
    if (!written.success || !(await dispositionWasWritten(supabase, orgId, callId, disposition))) return { status: 'error' };
    return { status: 'recorded', disposition };
  } catch (err) {
    console.error('[cockpit-auto-dial] conclude:', err instanceof Error ? err.message : 'erro');
    return { status: 'error' };
  }
}
