/**
 * Conversa SEM AÇÃO FINAL (caso Lippaus, 17/11): o lead atendeu e conversou, o desfecho do fluxo antigo foi "sem avanço"
 * ou "conversa relevante" e ninguém agendou nada. Sem esta regra a discagem liga de novo no dia seguinte.
 * Módulo PURO (constantes e datas). O servidor lê as ligações e aplica (`loadNoActionLeadIds`).
 */
export const NO_ACTION_COOLDOWN_DAYS = 7;

/**
 * Valores de `calls.sdr_disposition` (enum `call_disposition`: relevant_conversation, answered_no_progress,
 * callback_requested, no_answer, technical_failure, voicemail) que contam como "conversou e não decidiu".
 * `callback_requested` já tem ação (retorno agendado); `no_answer`/`voicemail`/`technical_failure` não houve conversa.
 */
export const NO_ACTION_DISPOSITIONS: readonly string[] = ['answered_no_progress', 'relevant_conversation'];

/** Início da janela: ligações a partir daqui ainda seguram o lead fora da fila. */
export function noActionCooldownCutoff(now: Date): Date {
  return new Date(now.getTime() - NO_ACTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}
