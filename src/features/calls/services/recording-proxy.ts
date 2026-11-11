import { recordingDurationMismatches } from './recording-validation';

/**
 * O proxy serve a cópia do Storage? Não, quando ela está marcada como
 * divergente ou quando a duração medida (metadata.recording_audio_seconds)
 * foge da tolerância. Nesses casos o proxy cai para `recording_url`.
 */
export function shouldServeStoredRecording(call: {
  recording_storage_path: string | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown> | null;
}): boolean {
  if (!call.recording_storage_path) return false;
  const meta = call.metadata ?? {};
  if (meta.recording_persist_status === 'mismatch') return false;
  const measured = meta.recording_audio_seconds;
  if (typeof measured === 'number' && recordingDurationMismatches(measured, call.duration_seconds)) return false;
  return true;
}
