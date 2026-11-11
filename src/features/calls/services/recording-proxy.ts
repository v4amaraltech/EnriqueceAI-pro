import { recordingDurationMismatches } from './recording-validation';

/**
 * Chave de metadata gravada pelo reparo quando a ligação é `unrepairable`: nem a
 * cópia do Storage nem o `recording_url` são desta ligação. Aditiva: nada é apagado.
 */
export const RECORDING_HIDDEN_KEY = 'recording_hidden';

type ProxyCall = {
  recording_storage_path: string | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown> | null;
};

/**
 * A gravação inteira (Storage e `recording_url`) está escondida do SDR?
 * Só vale junto de `mismatch`: um reparo posterior que grava `ok` libera sozinho.
 * Callface confirmado como desta ligação (`recording_duration_divergent`) nunca esconde.
 */
export function isRecordingHidden(metadata: Record<string, unknown> | null): boolean {
  const meta = metadata ?? {};
  if (meta.recording_duration_divergent === true) return false;
  return meta[RECORDING_HIDDEN_KEY] === true && meta.recording_persist_status === 'mismatch';
}

/**
 * O proxy serve a cópia do Storage? Não, quando ela está marcada como
 * divergente ou quando a duração medida (metadata.recording_audio_seconds)
 * foge da tolerância. Nesses casos o proxy cai para `recording_url`
 * (a menos que `isRecordingHidden`, que esconde os dois).
 */
export function shouldServeStoredRecording(call: ProxyCall): boolean {
  if (!call.recording_storage_path) return false;
  const meta = call.metadata ?? {};
  // Reparo confirmou que a gravação do Callface é desta ligação (fone+hora): serve.
  if (meta.recording_duration_divergent === true) return true;
  if (meta.recording_persist_status === 'mismatch') return false;
  const measured = meta.recording_audio_seconds;
  if (typeof measured === 'number' && recordingDurationMismatches(measured, call.duration_seconds))
    return false;
  return true;
}
