// O webphone atende a perna do RAMAL na hora (auto-atendimento do INVITE da
// API4COM), então `call.answeredAt` do cliente diz só que a página atendeu —
// não que o LEAD atendeu. Quem sabe isso é o webhook da API4COM, que grava
// `answered_at` (channel-answer da perna do lead) e, no fim, `hangup_cause`.
// Módulo PURO: a leitura da linha de `calls` vira um dos três estados abaixo.

export type LeadAnswer = 'answered' | 'not_answered' | 'unknown';

export interface CallAnswerSignals {
  answered_at: string | null;
  hangup_cause: string | null;
  duration_seconds: number | null;
}

/**
 * - `answered_at` presente → o lead (ou a caixa postal dele) atendeu;
 * - sem `answered_at` mas com `hangup_cause` → a ligação acabou sem atender
 *   (NUMBER_CHANGED, ORIGINATOR_CANCEL, NO_ANSWER…);
 * - nada ainda → o webhook não chegou: desconhecido.
 */
export function leadAnswerFromCallRow(row: CallAnswerSignals | null | undefined): LeadAnswer {
  if (!row) return 'unknown';
  if (row.answered_at) return 'answered';
  if (row.hangup_cause) return 'not_answered';
  if ((row.duration_seconds ?? 0) > 0) return 'answered';
  return 'unknown';
}

/** Intervalo entre consultas enquanto o webhook não chegou. */
export const LEAD_ANSWER_POLL_INTERVAL_MS = 3_000;
/** Teto de consultas por ligação (~2 min): depois disso fica "desconhecido". */
export const LEAD_ANSWER_MAX_POLLS = 40;
