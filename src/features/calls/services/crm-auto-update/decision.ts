// Decisão PURA (sem I/O) da atualização automática do CRM a partir da
// qualificação JEV de uma ligação. Usada pelo modo shadow (só registra a
// proposta) e pelo modo live (shouldApplyLiveVoicemail decide o que é escrito).
//
// Regras fixas:
//  - needs_review = true nunca aplica (vai para revisão humana);
//  - o que o SDR já registrou nunca é sobrescrito (sdr_disposition preenchido);
//  - status do lead só anda para frente (new → contacted → qualified);
//  - a proposta é calculada mesmo quando o veredito é skip, para comparar com o SDR;
//  - not_connected/voicemail nunca vira "atendeu sem avanço" (v1.1);
//  - pedido de opt-out na ligação vira skip opt_out_requested: só sinaliza, nunca aplica (v1.1).
import type { CallDisposition } from '../../types';
import { evaluateFlagRow, type FlagRow } from '@/features/contact-engine/services/flag-scope.service';

import {
  CRM_AUTO_UPDATE_LIVE_OUTCOME,
  CRM_AUTO_UPDATE_LIVE_VOICEMAIL_MIN_CONFIDENCE,
  CRM_AUTO_UPDATE_MIN_CONFIDENCE,
} from './constants';
import { type OptOutSignal, detectOptOutRequest } from './opt-out';

export type CrmAutoUpdateMode = 'off' | 'shadow' | 'live';

export type CrmAutoUpdateSkipReason =
  | 'org_not_allowed'
  | 'qualification_not_completed'
  | 'needs_review'
  | 'low_confidence'
  | 'unmapped_outcome'
  | 'already_dispositioned'
  | 'no_lead'
  | 'opt_out_requested';

export type NextActivityType = 'meeting' | 'callback' | 'retry' | 'cadence_advance' | 'none';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'unqualified' | 'archived';

export interface ProposedChanges {
  /** Valor para calls.sdr_disposition. */
  disposition: CallDisposition;
  /** Próxima atividade sugerida. `retry`/`cadence_advance` = a cadência segue sozinha. */
  next_activity: { type: NextActivityType; channel: 'phone' | null };
  /** Mudança de leads.status, ou null quando nada muda. */
  lead_status: { from: LeadStatus; to: LeadStatus } | null;
}

export interface CrmDecisionInput {
  mode: CrmAutoUpdateMode;
  qualification: {
    status: string;
    outcome: string | null;
    next_step_suggestion: string | null;
    confidence: number | null;
    needs_review: boolean;
  };
  call: {
    lead_id: string | null;
    sdr_disposition: string | null;
    /** O fluxo antigo do Power Dialer (metadata.ai_outcome) já gravou o desfecho. */
    legacy_ai_outcome_applied: boolean;
  };
  lead: { status: LeadStatus } | null;
  /** Texto da transcrição (call_transcripts_v2.text), para detectar opt-out. */
  transcript_text: string | null;
  /** Resumo da qualificação (call_qualifications.summary), também lido pelo detector de opt-out. */
  qualification_summary?: string | null;
}

/**
 * `opt_out` vem sempre preenchido (requested = false quando não há pedido).
 * É só um sinal: a decisão nunca apaga nem reescreve contato, lead, e-mail ou telefone.
 */
export type CrmDecision =
  | { verdict: 'would_apply'; proposed: ProposedChanges; skip_reason: null; opt_out: OptOutSignal }
  | {
      verdict: 'skip';
      proposed: ProposedChanges | null;
      skip_reason: CrmAutoUpdateSkipReason;
      opt_out: OptOutSignal;
    };

/**
 * Modo da org a partir das duas linhas de app_flags.
 * live exige shadow ligado E a org listada explicitamente na flag live
 * (`enabled = true` global na flag live é ignorado de propósito).
 */
export function resolveCrmAutoUpdateMode(
  shadowRow: FlagRow | null | undefined,
  liveRow: FlagRow | null | undefined,
  orgId: string,
): CrmAutoUpdateMode {
  if (!evaluateFlagRow(shadowRow, { orgId })) return 'off';
  const liveOrgs = Array.isArray(liveRow?.allow_org_ids)
    ? liveRow.allow_org_ids.map((id) => String(id).toLowerCase())
    : [];
  return liveOrgs.includes(orgId.toLowerCase()) ? 'live' : 'shadow';
}

const CONVERSATION_OUTCOMES = new Set(['meeting_booked', 'callback', 'not_interested', 'interested_no_next_step']);

/** Desfecho JEV → disposition do CRM. null = sem mapeamento seguro. */
export function mapOutcomeToDisposition(outcome: string | null): CallDisposition | null {
  switch (outcome) {
    case 'meeting_booked':
    case 'interested_no_next_step':
      return 'relevant_conversation';
    case 'callback':
      return 'callback_requested';
    case 'not_interested':
      return 'answered_no_progress';
    case 'not_connected':
    case 'voicemail':
      // A linha atendeu (o motor só roda em ligação atendida), mas sem conversa com
      // humano: caixa postal, URA ou "essa pessoa não está disponível". Nunca
      // "atendeu sem avanço", com ou sem prompt de caixa postal reconhecido no texto
      // (caso real 3e597c42: URA que o regex de caixa postal não pegava).
      return 'voicemail';
    default:
      return null;
  }
}

export function mapOutcomeToNextActivity(outcome: string | null): ProposedChanges['next_activity'] {
  switch (outcome) {
    case 'meeting_booked':
      return { type: 'meeting', channel: null };
    case 'callback':
      return { type: 'callback', channel: 'phone' };
    case 'not_connected':
    case 'voicemail':
      return { type: 'retry', channel: 'phone' };
    case 'interested_no_next_step':
      return { type: 'cadence_advance', channel: null };
    default:
      return { type: 'none', channel: null };
  }
}

/** Só avança: new → contacted quando houve conversa; new/contacted → qualified com reunião. */
export function proposeLeadStatus(
  outcome: string | null,
  current: LeadStatus | null,
): ProposedChanges['lead_status'] {
  if (!current) return null;
  if (outcome === 'meeting_booked' && (current === 'new' || current === 'contacted')) {
    return { from: current, to: 'qualified' };
  }
  if (outcome && CONVERSATION_OUTCOMES.has(outcome) && current === 'new') {
    return { from: current, to: 'contacted' };
  }
  return null;
}

export function buildProposedChanges(input: CrmDecisionInput): ProposedChanges | null {
  const { outcome } = input.qualification;
  const disposition = mapOutcomeToDisposition(outcome);
  if (!disposition) return null;
  return {
    disposition,
    next_activity: mapOutcomeToNextActivity(outcome),
    lead_status: proposeLeadStatus(outcome, input.lead?.status ?? null),
  };
}

export function decideCrmAutoUpdate(input: CrmDecisionInput): CrmDecision {
  const q = input.qualification;
  const proposed = q.status === 'completed' ? buildProposedChanges(input) : null;
  const opt_out = detectOptOutRequest(input.transcript_text, input.qualification_summary);
  const skip = (skip_reason: CrmAutoUpdateSkipReason): CrmDecision => ({
    verdict: 'skip',
    proposed,
    skip_reason,
    opt_out,
  });

  if (input.mode === 'off') return skip('org_not_allowed');
  if (q.status !== 'completed') return skip('qualification_not_completed');
  // Antes de needs_review/confiança: todo pedido de opt-out é contado na medição e
  // nunca vira would_apply ("atendeu, sem avanço, sem próxima atividade").
  if (opt_out.requested) return skip('opt_out_requested');
  if (q.needs_review) return skip('needs_review');
  if (typeof q.confidence !== 'number' || q.confidence < CRM_AUTO_UPDATE_MIN_CONFIDENCE) {
    return skip('low_confidence');
  }
  if (!proposed) return skip('unmapped_outcome');
  if (input.call.sdr_disposition || input.call.legacy_ai_outcome_applied) {
    return skip('already_dispositioned');
  }
  if (!input.call.lead_id) return skip('no_lead');
  return { verdict: 'would_apply', proposed, skip_reason: null, opt_out };
}

/**
 * A escrita live acontece? Só caixa postal, só em live, só com would_apply e só com
 * confiança >= 0,85. Usa o outcome JEV exato (não o disposition mapeado) para que
 * not_connected, que também propõe 'voicemail', fique só no log.
 */
export function shouldApplyLiveVoicemail(args: {
  mode: CrmAutoUpdateMode;
  decision: Pick<CrmDecision, 'verdict'>;
  outcome: string | null;
  confidence: number | null;
}): boolean {
  return (
    args.mode === 'live' &&
    args.decision.verdict === 'would_apply' &&
    args.outcome === CRM_AUTO_UPDATE_LIVE_OUTCOME &&
    typeof args.confidence === 'number' &&
    Number.isFinite(args.confidence) &&
    args.confidence >= CRM_AUTO_UPDATE_LIVE_VOICEMAIL_MIN_CONFIDENCE
  );
}
