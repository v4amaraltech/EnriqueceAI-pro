/**
 * Caixa postal que a operadora marca como atendida (calls.connected = true).
 * Olha só o começo da transcrição: a mensagem da operadora vem logo no início.
 *
 * Fica de fora de propósito (o lead costuma atender depois):
 * - "se você disser seu nome e o motivo da ligação" (triagem de chamadas do iPhone);
 * - "não está disponível", "após o sinal", "deixe outra mensagem".
 */
export const VOICEMAIL_PREFIX_CHARS = 250;

const VOICEMAIL_PATTERN = /(correio de voz|caixa postal|grave (a )?sua mensagem)/;

export function isVoicemailTranscript(text: string | null | undefined): boolean {
  if (!text) return false;
  return VOICEMAIL_PATTERN.test(text.slice(0, VOICEMAIL_PREFIX_CHARS).toLowerCase());
}
