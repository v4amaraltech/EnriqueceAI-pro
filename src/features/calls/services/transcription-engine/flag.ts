import { isScopedFlagEnabled } from '@/features/contact-engine/services/flag-scope.service';

import { ENGINE_MIN_DURATION_SECONDS, TRANSCRIPTION_ENGINE_FLAG_KEY } from './constants';

/** Flag por organização. Erro de leitura conta como desligada. */
export function isTranscriptionEngineEnabled(orgId: string): Promise<boolean> {
  return isScopedFlagEnabled(TRANSCRIPTION_ENGINE_FLAG_KEY, { orgId });
}

/**
 * Decisão pura do hangup: ligação atendida, com duração mínima e flag ligada.
 * Não depende de recordUrl: a gravação pode chegar depois e o worker resolve o áudio.
 */
export function shouldTriggerEngineOnHangup(args: {
  answered: boolean;
  durationSeconds: number;
  flagEnabled: boolean;
}): boolean {
  return args.flagEnabled && args.answered && args.durationSeconds >= ENGINE_MIN_DURATION_SECONDS;
}
