import { readAiOutcome, AI_OUTCOME_REVIEW_CONFIDENCE } from '@/features/calls/ai-outcome';
import { isConnectedCall } from '@/features/calls/connection';
import type { CallDisposition, CallStatus } from '@/features/calls/types';

/**
 * "Conversa real" (M-1, spec §10.1; ALTERA a regra C-3): só conversa de verdade tira o lead do motor no dia.
 * Caixa postal, filtro de chamadas e falha técnica voltam à fila e contam como TENTATIVA (até 3/dia).
 * Módulo PURO. Só importa regras já existentes de `features/calls` (nunca as edita).
 *
 * Decide pela PRIMEIRA fonte que tiver dado:
 *  1. desfecho do SDR (`sdr_disposition`);
 *  2. desfecho da IA aplicado (`metadata.ai_outcome`), com a mesma confiança mínima do produto;
 *  3. regra "conectada" do produto: `answered_at` + duração >= 50 s e não-caixa-postal (`isConnectedCall`).
 */

/** Desfechos que significam que houve conversa. */
export const CONVERSATION_DISPOSITIONS: ReadonlySet<string> = new Set<CallDisposition>([
  'relevant_conversation',
  'answered_no_progress',
  'callback_requested',
]);

/** Desfechos que significam que NÃO houve conversa (o lead volta à fila). */
export const NON_CONVERSATION_DISPOSITIONS: ReadonlySet<string> = new Set<CallDisposition>(['voicemail', 'no_answer', 'technical_failure']);

export interface RealConversationCall {
  sdr_disposition?: string | null;
  answered_at?: string | null;
  duration_seconds?: number | null;
  status?: string | null;
  metadata?: unknown;
}

/** Desfecho da IA que vale: classificou (`done`), foi aplicado, sem revisão pendente e com a confiança mínima. */
function aiDisposition(metadata: unknown): string | null {
  const ai = readAiOutcome(metadata);
  if (!ai || ai.status !== 'done' || !ai.disposition) return null;
  if (ai.applied === false || ai.needs_review === true) return null;
  if (typeof ai.confidence !== 'number' || ai.confidence < AI_OUTCOME_REVIEW_CONFIDENCE) return null;
  return ai.disposition;
}

function decideByDisposition(disposition: string | null | undefined): boolean | null {
  if (!disposition) return null;
  if (CONVERSATION_DISPOSITIONS.has(disposition)) return true;
  if (NON_CONVERSATION_DISPOSITIONS.has(disposition)) return false;
  return null; // valor desconhecido: cai para a próxima fonte
}

export function isRealConversation(call: RealConversationCall): boolean {
  const bySdr = decideByDisposition(call.sdr_disposition);
  if (bySdr !== null) return bySdr;
  const byAi = decideByDisposition(aiDisposition(call.metadata));
  if (byAi !== null) return byAi;
  return isConnectedCall({
    status: (call.status ?? 'not_connected') as CallStatus,
    duration_seconds: call.duration_seconds ?? 0,
    answered_at: call.answered_at ?? null,
    sdr_disposition: (call.sdr_disposition ?? null) as CallDisposition | null,
  });
}

/** Alguma das ligações de hoje foi conversa real? */
export function hadRealConversation(calls: readonly RealConversationCall[]): boolean {
  return calls.some(isRealConversation);
}
