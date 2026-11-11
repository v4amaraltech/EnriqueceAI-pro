// Decisão PURA (sem I/O) da atualização automática do CRM a partir da
// qualificação JEV de uma ligação. Usada pelo modo shadow (só registra a
// proposta) e, no futuro, pelo modo live.
//
// Regras fixas:
//  - needs_review = true nunca aplica (vai para revisão humana);
//  - o que o SDR já registrou nunca é sobrescrito (sdr_disposition preenchido);
//  - status do lead só anda para frente (new → contacted → qualified);
//  - a proposta é calculada mesmo quando o veredito é skip, para comparar com o SDR.
import { hasMailboxPrompt } from '../transcription-engine/review';
import type { CallDisposition } from '../../types';
import { evaluateFlagRow, type FlagRow } from '@/features/contact-engine/services/flag-scope.service';

import { CRM_AUTO_UPDATE_MIN_CONFIDENCE } from './constants';

export type CrmAutoUpdateMode = 'off' | 'shadow' | 'live';

export type CrmAutoUpdateSkipReason =
  | 'org_not_allowed'
  | 'qualification_not_completed'
  | 'needs_review'
  | 'low_confidence'
  | 'unmapped_outcome'
  | 'already_dispositioned'
  | 'no_lead';

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
  /** Texto da transcrição (call_transcripts_v2.text), para separar caixa postal. */
  transcript_text: string | null;
}

export type CrmDecision =
  | { verdict: 'would_apply'; proposed: ProposedChanges; skip_reason: null }
  | { verdict: 'skip'; proposed: ProposedChanges | null; skip_reason: CrmAutoUpdateSkipReason };

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
export function mapOutcomeToDisposition(
  outcome: string | null,
  transcriptText: string | null,
): CallDisposition | null {
  switch (outcome) {
    case 'meeting_booked':
    case 'interested_no_next_step':
      return 'relevant_conversation';
    case 'callback':
      return 'callback_requested';
    case 'not_interested':
      return 'answered_no_progress';
    case 'not_connected':
      // A linha atendeu (o motor só roda em ligação atendida): caixa postal ou
      // URA/secretária sem conversa real com o decisor.
      return transcriptText && hasMailboxPrompt(transcriptText) ? 'voicemail' : 'answered_no_progress';
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
  const disposition = mapOutcomeToDisposition(outcome, input.transcript_text);
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
  const skip = (skip_reason: CrmAutoUpdateSkipReason): CrmDecision => ({
    verdict: 'skip',
    proposed,
    skip_reason,
  });

  if (input.mode === 'off') return skip('org_not_allowed');
  if (q.status !== 'completed') return skip('qualification_not_completed');
  if (q.needs_review) return skip('needs_review');
  if (typeof q.confidence !== 'number' || q.confidence < CRM_AUTO_UPDATE_MIN_CONFIDENCE) {
    return skip('low_confidence');
  }
  if (!proposed) return skip('unmapped_outcome');
  if (input.call.sdr_disposition || input.call.legacy_ai_outcome_applied) {
    return skip('already_dispositioned');
  }
  if (!input.call.lead_id) return skip('no_lead');
  return { verdict: 'would_apply', proposed, skip_reason: null };
}
