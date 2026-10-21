import { describe, expect, it } from 'vitest';

import { audioQualityVerdict, summarizeRtcStats } from './webphone-audio-stats';

const NOW = new Date('2026-10-21T19:00:00.000Z');

/** Imita um `RTCStatsReport`: um Map de id → stats, como o navegador devolve. */
function fakeReport(entries: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  return new Map(entries.map((e, i) => [String(e.id ?? `s${i}`), e]));
}

describe('summarizeRtcStats', () => {
  it('resume inbound-rtp de áudio e o RTT do par de candidatos nomeado', () => {
    const report = fakeReport([
      { type: 'inbound-rtp', kind: 'audio', packetsReceived: 4900, packetsLost: 100, jitter: 0.0123 },
      { type: 'outbound-rtp', kind: 'audio', packetsSent: 5000 },
      { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.0456 },
      { type: 'candidate-pair', state: 'in-progress', currentRoundTripTime: 0.9 },
    ]);
    expect(summarizeRtcStats(report, NOW)).toEqual({
      packetsReceived: 4900,
      packetsLost: 100,
      lossPercent: 2,
      jitterMs: 12.3,
      rttMs: 46,
      collectedAt: NOW.toISOString(),
    });
  });

  it('aceita uma lista de entradas (sem Map) e usa o RTT do remote-inbound-rtp quando não há par nomeado', () => {
    const stats = summarizeRtcStats(
      [
        { type: 'inbound-rtp', mediaType: 'audio', packetsReceived: 10, packetsLost: 0 },
        { type: 'remote-inbound-rtp', roundTripTime: 0.2 },
      ],
      NOW,
    );
    expect(stats).toMatchObject({ packetsReceived: 10, packetsLost: 0, lossPercent: 0, jitterMs: null, rttMs: 200 });
  });

  it('ignora vídeo e devolve null sem fluxo de áudio recebido', () => {
    expect(summarizeRtcStats(fakeReport([{ type: 'inbound-rtp', kind: 'video', packetsReceived: 5 }]), NOW)).toBeNull();
    expect(summarizeRtcStats(fakeReport([]), NOW)).toBeNull();
    expect(summarizeRtcStats(null, NOW)).toBeNull();
  });

  it('não quebra com valores ausentes ou inválidos', () => {
    const stats = summarizeRtcStats(fakeReport([{ type: 'inbound-rtp', kind: 'audio', packetsReceived: 'x', jitter: NaN }]), NOW);
    expect(stats).toMatchObject({ packetsReceived: 0, packetsLost: 0, lossPercent: 0, jitterMs: null, rttMs: null });
  });

  it('com dois fluxos de áudio fica o que recebeu mais pacotes', () => {
    const stats = summarizeRtcStats(
      fakeReport([
        { id: 'a', type: 'inbound-rtp', kind: 'audio', packetsReceived: 3, packetsLost: 0 },
        { id: 'b', type: 'inbound-rtp', kind: 'audio', packetsReceived: 300, packetsLost: 30 },
      ]),
      NOW,
    );
    expect(stats).toMatchObject({ packetsReceived: 300, packetsLost: 30, lossPercent: 9.1 });
  });
});

describe('audioQualityVerdict', () => {
  const base = { packetsReceived: 100, packetsLost: 0, lossPercent: 0, jitterMs: 5, rttMs: 40, collectedAt: NOW.toISOString() };

  it('bom / regular / ruim por perda e jitter', () => {
    expect(audioQualityVerdict(base)).toBe('good');
    expect(audioQualityVerdict({ ...base, lossPercent: 3 })).toBe('fair');
    expect(audioQualityVerdict({ ...base, jitterMs: 35 })).toBe('fair');
    expect(audioQualityVerdict({ ...base, lossPercent: 6 })).toBe('poor');
    expect(audioQualityVerdict({ ...base, jitterMs: 80 })).toBe('poor');
    expect(audioQualityVerdict(null)).toBeNull();
  });
});
