// Classificação PURA (sem I/O) do desfecho de uma ligação pelo sinal determinístico
// do hangup da API4COM (hangup_cause + answered_at + duração). Só alimenta o log
// sombra (crm_auto_update_shadow_log, rules_version 'hangup_v1'). Nunca escreve no CRM.
//
// Cobre só o que o motor JEV não pega: ligação não atendida, ou atendida com menos de
// ENGINE_MIN_DURATION_SECONDS. Atendida com 30 s ou mais é do JEV (UNIQUE (call_id) no log).
//
// Fica de fora, de propósito (retorna null, nada é gravado):
//  - NORMAL_CLEARING atendida curta: precisa de áudio (humano x caixa postal);
//  - ORIGINATOR_CANCEL: o SDR desistiu; os desfechos registrados se dividem entre
//    não atendeu, caixa postal e falha técnica (sinal misto);
//  - causa nula ou desconhecida;
//  - causa de "não atendeu" com answered_at preenchido (sinal contraditório).
import type { CallDisposition } from '../../types';
import { ENGINE_MIN_DURATION_SECONDS } from '../transcription-engine/constants';

import type { CrmAutoUpdateSkipReason, ProposedChanges } from './decision';

/** Desfecho interno gravado no input_snapshot. Mais fino que a disposition (ex.: busy). */
export type HangupOutcome = 'voicemail' | 'no_answer' | 'busy' | 'rejected' | 'invalid_number' | 'technical_failure';

export interface HangupClassificationInput {
  hangupCause: string | null | undefined;
  /** Timestamp de atendimento. Nulo ou string vazia = não atendida. */
  answeredAt: string | null | undefined;
  durationSeconds: number | null | undefined;
}

export interface HangupClassification {
  outcome: HangupOutcome;
  /** Causa normalizada (maiúscula, sem espaços nas pontas). */
  hangup_cause: string;
  /** Sinal determinístico: sempre 1. */
  confidence: 1;
  proposed: ProposedChanges;
}

const RETRY_PHONE: ProposedChanges['next_activity'] = { type: 'retry', channel: 'phone' };
const NO_NEXT: ProposedChanges['next_activity'] = { type: 'none', channel: null };

interface CauseRule {
  outcome: HangupOutcome;
  disposition: CallDisposition;
  next_activity: ProposedChanges['next_activity'];
  /** Quando true, só classifica sem answered_at. */
  requiresUnanswered: boolean;
}

const rule = (
  outcome: HangupOutcome,
  disposition: CallDisposition,
  next_activity: ProposedChanges['next_activity'],
  requiresUnanswered: boolean,
): CauseRule => ({ outcome, disposition, next_activity, requiresUnanswered });

/**
 * NUMBER_CHANGED é "não atendeu" (decisão do Vinicius, 12/11): quando o SDR registrou
 * desfecho, foram 43 no_answer e nenhuma caixa postal. O guia API4COM e o PR598
 * continuam tratando a causa como caixa postal na telefonia (rótulo e status no_contact);
 * este caminho do log sombra segue a prática do SDR. Número inválido não insiste
 * (próxima atividade none). USER_BUSY vira no_answer porque call_disposition não tem busy.
 */
const CAUSE_RULES: Readonly<Record<string, CauseRule>> = {
  NUMBER_CHANGED: rule('no_answer', 'no_answer', RETRY_PHONE, false),
  NO_ANSWER: rule('no_answer', 'no_answer', RETRY_PHONE, true),
  NO_USER_RESPONSE: rule('no_answer', 'no_answer', RETRY_PHONE, true),
  ALLOTTED_TIMEOUT: rule('no_answer', 'no_answer', RETRY_PHONE, true),
  USER_BUSY: rule('busy', 'no_answer', RETRY_PHONE, true),
  CALL_REJECTED: rule('rejected', 'no_answer', RETRY_PHONE, true),
  // A causa é autoritativa: número inválido mesmo com channel-answer.
  UNALLOCATED_NUMBER: rule('invalid_number', 'technical_failure', NO_NEXT, false),
  INVALID_NUMBER_FORMAT: rule('invalid_number', 'technical_failure', NO_NEXT, false),
  NORMAL_TEMPORARY_FAILURE: rule('technical_failure', 'technical_failure', RETRY_PHONE, true),
  RECOVERY_ON_TIMER_EXPIRE: rule('technical_failure', 'technical_failure', RETRY_PHONE, true),
};

/** Atendida = answered_at é uma string não vazia com data válida. */
export function isAnsweredTimestamp(answeredAt: string | null | undefined): boolean {
  if (typeof answeredAt !== 'string') return false;
  const v = answeredAt.trim();
  if (!v) return false;
  return !Number.isNaN(new Date(v.includes('T') ? v : v.replace(' ', 'T')).getTime());
}

/** Classifica pelo hangup, ou null quando não há sinal claro (ou a ligação é do JEV). */
export function classifyHangupForCrm(input: HangupClassificationInput): HangupClassification | null {
  const answered = isAnsweredTimestamp(input.answeredAt);
  const duration = Number(input.durationSeconds) || 0;
  // Elegível para o JEV: não compete pela linha única do log.
  if (answered && duration >= ENGINE_MIN_DURATION_SECONDS) return null;

  const cause = typeof input.hangupCause === 'string' ? input.hangupCause.trim().toUpperCase() : '';
  if (!cause) return null;
  const r = CAUSE_RULES[cause];
  if (!r) return null;
  if (r.requiresUnanswered && answered) return null;

  return {
    outcome: r.outcome,
    hangup_cause: cause,
    confidence: 1,
    proposed: { disposition: r.disposition, next_activity: { ...r.next_activity }, lead_status: null },
  };
}

export type HangupCrmDecision =
  | { verdict: 'would_apply'; proposed: ProposedChanges; skip_reason: null }
  | {
      verdict: 'skip';
      proposed: ProposedChanges;
      skip_reason: Extract<CrmAutoUpdateSkipReason, 'already_dispositioned' | 'no_lead'>;
    };

/**
 * Veredito do log para uma classificação. A proposta vai preenchida também no skip,
 * para comparar com o SDR. Sem needs_review, low_confidence nem opt-out (não há JEV
 * nem transcrição neste caminho).
 */
export function decideHangupCrm(args: {
  classification: HangupClassification;
  call: { lead_id: string | null; sdr_disposition: string | null; legacy_ai_outcome_applied: boolean };
}): HangupCrmDecision {
  const { classification, call } = args;
  const proposed = classification.proposed;
  if (call.sdr_disposition || call.legacy_ai_outcome_applied) {
    return { verdict: 'skip', proposed, skip_reason: 'already_dispositioned' };
  }
  if (!call.lead_id) return { verdict: 'skip', proposed, skip_reason: 'no_lead' };
  return { verdict: 'would_apply', proposed, skip_reason: null };
}
