import { describe, expect, it } from 'vitest';

import { mergeLiveAmdMetadata, type LiveAmdPatch } from './live-amd-metadata';

const base: LiveAmdPatch = {
  prediction: 'voicemail',
  phrase: 'caixa postal',
  confidence: 0.9,
  latencyMs: 1000,
  predictedAt: '2026-11-17T12:00:00.000Z',
};
const hangup = { at: '2026-11-17T12:00:05.000Z', phrase: 'caixa postal', prediction: 'voicemail', confidence: 0.9 };

const liveOf = (r: Record<string, unknown>) => r.live_amd as Record<string, unknown>;

describe('mergeLiveAmdMetadata: marcador de quem desligou', () => {
  it('sem o campo, mantém o que já está gravado', () => {
    const first = mergeLiveAmdMetadata({}, { ...base, autoHangup: hangup });
    const final = mergeLiveAmdMetadata(first, { ...base, predictedAt: '2026-11-17T12:05:00.000Z' });
    expect(liveOf(final).auto_hangup).toEqual(hangup);
    expect(liveOf(final).predicted_at).toBe('2026-11-17T12:05:00.000Z');
  });

  it('com o campo novo, vale o novo', () => {
    const first = mergeLiveAmdMetadata({}, { ...base, autoHangup: hangup });
    const final = mergeLiveAmdMetadata(first, { ...base, autoHangup: { ...hangup, at: 'novo' } });
    expect(liveOf(final).auto_hangup).toMatchObject({ at: 'novo' });
  });

  it('o marcador não apaga transcript, telemetria nem next_activity', () => {
    const first = mergeLiveAmdMetadata(
      {},
      {
        ...base,
        transcript: 'texto',
        telemetry: { bytesSent: 10 },
        nextActivity: { suggestion: 'not_connected', reason: 'r', confidence: 0.8 },
      },
    );
    const final = mergeLiveAmdMetadata(first, { ...base, autoHangup: hangup });
    expect(liveOf(final)).toMatchObject({
      transcript: 'texto',
      bytes_sent: 10,
      next_activity_suggestion: 'not_connected',
      next_activity_reason: 'r',
      next_activity_confidence: 0.8,
      auto_hangup: hangup,
    });
  });

  it('sem marcador nenhuma chave nova aparece', () => {
    expect(liveOf(mergeLiveAmdMetadata({}, base))).not.toHaveProperty('auto_hangup');
  });
});
