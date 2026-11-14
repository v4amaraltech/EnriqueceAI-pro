import {
  AI_DISPOSITION_LABELS,
  AI_OUTCOME_REVIEW_CONFIDENCE,
  readAiOutcome,
} from '@/features/calls/ai-outcome';
import {
  OUT_OF_AREA_LABEL,
  isOutOfAreaCall,
  leadAnswerFromCallRow,
} from '@/features/integrations/webphone/webphone-lead-answer';

import type { CockpitCallOutcome } from '../types';

export interface CallOutcomeRow {
  answered_at: string | null;
  hangup_cause: string | null;
  duration_seconds: number | null;
  sdr_disposition: string | null;
  notes: string | null;
  transcription_status: string | null;
  metadata: Record<string, unknown> | null;
}

const SDR_ONLY_LABELS: Record<string, string> = { no_answer: 'Não atendeu' };

export function dispositionLabel(
  disposition: string | null | undefined,
  hangupCause?: string | null,
): string {
  if (!disposition) return 'Sem classificação';
  // Só o rótulo muda: o desfecho gravado continua no_answer.
  if (disposition === 'no_answer' && isOutOfAreaCall({ hangupCause })) return OUT_OF_AREA_LABEL;
  return (
    (AI_DISPOSITION_LABELS as Record<string, string>)[disposition] ??
    SDR_ONLY_LABELS[disposition] ??
    disposition
  );
}

/**
 * Converte a linha de `calls` no estado mostrado no cartão. Função pura:
 * a mesma linha sempre dá o mesmo estado, então consultar de novo (replay do
 * webhook, polling repetido) nunca duplica nem altera o resultado.
 *
 * Prioridade: resultado do SDR (correção humana vence) > IA aplicada > exceção >
 * pendente. Ligação não atendida não espera transcrição.
 */
export function buildCallOutcomeView(row: CallOutcomeRow): CockpitCallOutcome {
  const ai = readAiOutcome(row.metadata);
  const answer = leadAnswerFromCallRow(row);

  if (row.sdr_disposition) {
    const aiSummary = ai?.status === 'done' ? (ai.summary ?? null) : null;
    return {
      state: 'confirmed',
      source: 'sdr',
      disposition: row.sdr_disposition,
      summary: aiSummary ?? row.notes?.trim() ?? null,
      callbackAt: ai?.callback_at ?? null,
      callbackScheduled: Boolean(ai?.scheduled_activity_id),
      hangupCause: row.hangup_cause,
    };
  }

  if (answer === 'unknown') return { state: 'waiting_call' };
  if (answer === 'not_answered') return { state: 'not_answered', hangupCause: row.hangup_cause };

  if (!ai) {
    return row.transcription_status === 'pending' || row.transcription_status === 'processing'
      ? { state: 'pending', stage: 'transcription' }
      : { state: 'none' };
  }

  if (ai.status === 'pending') {
    const transcribed = row.transcription_status === 'completed';
    return { state: 'pending', stage: transcribed ? 'classification' : 'transcription' };
  }
  if (ai.status === 'processing') return { state: 'pending', stage: 'classification' };

  if (ai.status === 'failed') {
    return {
      state: 'exception',
      reason: 'failed',
      suggestedDisposition: null,
      confidence: null,
      summary: null,
    };
  }

  // status === 'done'
  const confidence = ai.confidence ?? null;
  if (ai.applied === false) {
    return {
      state: 'exception',
      reason: 'low_confidence',
      suggestedDisposition: ai.disposition ?? null,
      confidence,
      summary: ai.summary ?? null,
    };
  }
  if (ai.needs_review) {
    const lowConfidence = confidence !== null && confidence < AI_OUTCOME_REVIEW_CONFIDENCE;
    return {
      state: 'exception',
      reason: lowConfidence ? 'low_confidence' : 'apply_failed',
      suggestedDisposition: ai.disposition ?? null,
      confidence,
      summary: ai.summary ?? null,
    };
  }
  return {
    state: 'confirmed',
    source: 'ai',
    disposition: ai.disposition ?? 'answered_no_progress',
    summary: ai.summary ?? null,
    callbackAt: ai.callback_at ?? null,
    callbackScheduled: Boolean(ai.scheduled_activity_id),
  };
}
