import type { CallDisposition } from '@/features/calls/types';

/**
 * O SDR concluiu o lead pelo painel durante a ligação do motor (Agendar reunião ou Desqualificar). O desfecho
 * é do painel (ele já grava no lead); aqui só se define o MÍNIMO para a ligação não ficar com desfecho pendente.
 * Módulo PURO. Devolve sempre um valor de `CallDisposition`.
 */
export type ExternalConclusionKind = 'scheduled' | 'lost' | 'callback' | 'referred';

/**
 *  - agendou reunião → `relevant_conversation` (houve conversa);
 *  - desqualificou   → `answered_no_progress` ("Atendeu, sem avanço"), o valor existente mais próximo de "perdido";
 *  - ligar depois    → `callback_requested` (o retorno já foi agendado pelo painel);
 *  - indicou outro   → `referred_contact`;
 *  - a ligação NÃO foi atendida (telemetria) → `no_answer`, para não contradizer o que o sistema já sabe
 *    (`dispositionOptionsForTelemetry`: desfecho de conversa pressupõe atendimento).
 */
export function dispositionForExternalConclusion(kind: ExternalConclusionKind, answered: boolean): CallDisposition {
  if (!answered) return 'no_answer';
  if (kind === 'callback') return 'callback_requested';
  if (kind === 'referred') return 'referred_contact';
  return kind === 'scheduled' ? 'relevant_conversation' : 'answered_no_progress';
}
