import { describe, expect, it } from 'vitest';

import {
  AI_OUTCOME_MIN_DURATION_SECONDS,
  isAiOutcomePending,
  readAiOutcome,
  shouldTranscribeOnHangup,
  transcriptionMinDurationFor,
} from './ai-outcome';
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from './schemas/call.schemas';

const PENDING = { api4com_call_id: 'x', ai_outcome: { status: 'pending' } };

describe('ai-outcome', () => {
  it('lê o status e ignora lixo', () => {
    expect(readAiOutcome(PENDING)?.status).toBe('pending');
    expect(readAiOutcome({ ai_outcome: { status: 'whatever' } })).toBeNull();
    expect(readAiOutcome(null)).toBeNull();
    expect(isAiOutcomePending({ ai_outcome: { status: 'done' } })).toBe(false);
  });

  it('piso de 10 s só para ligação que espera a IA; demais seguem 5 min', () => {
    expect(transcriptionMinDurationFor(PENDING)).toBe(AI_OUTCOME_MIN_DURATION_SECONDS);
    expect(transcriptionMinDurationFor({ api4com_call_id: 'x' })).toBe(TRANSCRIPTION_MIN_DURATION_SECONDS);
    expect(transcriptionMinDurationFor({ ai_outcome: { status: 'done' } })).toBe(TRANSCRIPTION_MIN_DURATION_SECONDS);
  });

  it('hangup: dispara transcrição de 30 s do Power Dialer, não de ligação comum', () => {
    expect(shouldTranscribeOnHangup({ recordUrl: 'https://r', durationSeconds: 30, metadata: PENDING })).toBe(true);
    expect(shouldTranscribeOnHangup({ recordUrl: 'https://r', durationSeconds: 30, metadata: {} })).toBe(false);
    expect(shouldTranscribeOnHangup({ recordUrl: 'https://r', durationSeconds: 5, metadata: PENDING })).toBe(false);
    expect(shouldTranscribeOnHangup({ recordUrl: null, durationSeconds: 60, metadata: PENDING })).toBe(false);
    expect(shouldTranscribeOnHangup({ recordUrl: 'https://r', durationSeconds: 300, metadata: {} })).toBe(true);
  });
});
