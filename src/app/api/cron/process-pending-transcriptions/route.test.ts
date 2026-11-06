import { describe, it, expect } from 'vitest';

import { AI_OUTCOME_EXPIRE_AFTER_MS, aiOutcomeExpiryReason, isTooShortToTranscribe } from './route';
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from '@/features/calls/schemas/call.schemas';

describe('isTooShortToTranscribe', () => {
  it('is true just below the minimum duration', () => {
    expect(isTooShortToTranscribe(TRANSCRIPTION_MIN_DURATION_SECONDS - 1)).toBe(true);
  });

  it('is false exactly at the minimum duration (eligible)', () => {
    expect(isTooShortToTranscribe(TRANSCRIPTION_MIN_DURATION_SECONDS)).toBe(false);
  });

  it('is false well above the minimum duration', () => {
    expect(isTooShortToTranscribe(TRANSCRIPTION_MIN_DURATION_SECONDS + 600)).toBe(false);
  });

  it('is true for a very short call', () => {
    expect(isTooShortToTranscribe(1)).toBe(true);
  });

  it('is false for NULL duration (not yet finalized — leave alone)', () => {
    expect(isTooShortToTranscribe(null)).toBe(false);
  });
});

describe('ligação do Power Dialer esperando a IA (piso de 10 s)', () => {
  const PENDING = { ai_outcome: { status: 'pending' } };

  it('30 s com ai_outcome pendente NÃO é curta demais', () => {
    expect(isTooShortToTranscribe(30, PENDING)).toBe(false);
    expect(isTooShortToTranscribe(30, {})).toBe(true);
    expect(isTooShortToTranscribe(5, PENDING)).toBe(true);
  });

  const now = new Date('2026-11-05T20:00:00.000Z');
  const old = new Date(now.getTime() - AI_OUTCOME_EXPIRE_AFTER_MS - 1000).toISOString();
  const recent = new Date(now.getTime() - 60_000).toISOString();

  it('espera a gravação chegar antes de desistir', () => {
    expect(aiOutcomeExpiryReason({ created_at: recent, recording_url: null, duration_seconds: 0, metadata: PENDING }, now)).toBeNull();
    expect(aiOutcomeExpiryReason({ created_at: old, recording_url: null, duration_seconds: 40, metadata: PENDING }, now)).toBe('no_recording');
    expect(aiOutcomeExpiryReason({ created_at: old, recording_url: 'r', duration_seconds: 4, metadata: PENDING }, now)).toBe(
      'duration_too_short',
    );
    expect(aiOutcomeExpiryReason({ created_at: old, recording_url: 'r', duration_seconds: 40, metadata: PENDING }, now)).toBeNull();
  });

  it('processing travado há mais de 30 min expira', () => {
    const stuck = { ai_outcome: { status: 'processing', started_at: new Date(now.getTime() - 31 * 60_000).toISOString() } };
    const fresh = { ai_outcome: { status: 'processing', started_at: new Date(now.getTime() - 60_000).toISOString() } };
    expect(aiOutcomeExpiryReason({ created_at: old, recording_url: 'r', duration_seconds: 40, metadata: stuck }, now)).toBe('processing_stuck');
    expect(aiOutcomeExpiryReason({ created_at: old, recording_url: 'r', duration_seconds: 40, metadata: fresh }, now)).toBeNull();
  });
});
