/**
 * Decide se um evento do webhook API4COM deve disparar a cópia da gravação para o Storage.
 *
 * Só no `channel-hangup`. No `channel-answer` o arquivo remoto ainda está sendo gravado
 * (cópia truncada) ou a URL do listener ainda serve a ligação anterior do mesmo ramal.
 * Salvar `calls.recording_url` no answer continua permitido; copiar para o Storage não.
 */
export function shouldPersistRecordingOnEvent(
  eventType: string,
  urls: { recordUrl?: string | null; existingRecordingUrl?: string | null },
): boolean {
  if (eventType !== 'channel-hangup') return false;
  return !!(urls.recordUrl || urls.existingRecordingUrl);
}
