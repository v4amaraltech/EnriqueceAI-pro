import { describe, it, expect } from 'vitest';

import { isTooShortToTranscribe } from './route';
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
