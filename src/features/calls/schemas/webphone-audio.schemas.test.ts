import { describe, expect, it } from 'vitest';

import { mergeWebphoneAudioMetadata, saveWebphoneCallAudioSchema } from './webphone-audio.schemas';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000001';
const stats = { packetsReceived: 100, packetsLost: 2, lossPercent: 2, jitterMs: 12.3, rttMs: 46, collectedAt: '2026-10-21T19:00:00.000Z' };

describe('saveWebphoneCallAudioSchema', () => {
  it('aceita avaliação de 1 a 5, estatísticas, ou ambas', () => {
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID, audioQuality: 5 }).success).toBe(true);
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID, audioStats: stats }).success).toBe(true);
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID, audioQuality: 1, audioStats: stats }).success).toBe(true);
  });

  it('recusa nota fora de 1–5, não inteira, callId inválido e pedido vazio', () => {
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID, audioQuality: 0 }).success).toBe(false);
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID, audioQuality: 6 }).success).toBe(false);
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID, audioQuality: 3.5 }).success).toBe(false);
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: 'abc', audioQuality: 3 }).success).toBe(false);
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID }).success).toBe(false);
    expect(saveWebphoneCallAudioSchema.safeParse({ callId: CALL_ID, audioStats: { ...stats, lossPercent: 150 } }).success).toBe(false);
  });
});

describe('mergeWebphoneAudioMetadata', () => {
  it('preserva o metadata existente (id da API4COM, gateway, webhook)', () => {
    const existing = { api4com_call_id: 'f0075b2e', gateway: 'flux-org', webhook_linked: true };
    expect(mergeWebphoneAudioMetadata(existing, { audioQuality: 4 })).toEqual({ ...existing, audio_quality: 4 });
    expect(mergeWebphoneAudioMetadata(existing, { audioStats: stats })).toEqual({ ...existing, audio_stats: stats });
  });

  it('metadata null, lista ou texto (legado) é tratado como vazio', () => {
    expect(mergeWebphoneAudioMetadata(null, { audioQuality: 2 })).toEqual({ audio_quality: 2 });
    expect(mergeWebphoneAudioMetadata([1, 2], { audioQuality: 2 })).toEqual({ audio_quality: 2 });
    expect(mergeWebphoneAudioMetadata('x', { audioStats: stats })).toEqual({ audio_stats: stats });
  });

  it('só escreve o que veio: avaliação sem estatísticas não apaga audio_stats anterior', () => {
    const existing = { audio_stats: stats };
    expect(mergeWebphoneAudioMetadata(existing, { audioQuality: 5 })).toEqual({ audio_stats: stats, audio_quality: 5 });
  });
});
