// Resumo das estatísticas WebRTC de uma ligação do webphone. Módulo PURO
// (testável com um `RTCStatsReport` falso) — o cliente JsSIP só chama
// `session.connection.getStats()` e entrega o relatório aqui.
//
// Vai para `calls.metadata.audio_stats` (story api4com-embedded-webphone,
// bloco 3). Nada de coluna nova.

export interface WebphoneAudioStats {
  /** Pacotes de áudio recebidos do outro lado. */
  packetsReceived: number;
  /** Pacotes de áudio perdidos (relato do receptor local). */
  packetsLost: number;
  /** Perda em % sobre recebidos + perdidos, com 1 casa decimal. */
  lossPercent: number;
  /** Jitter do áudio recebido em ms (null quando o navegador não informa). */
  jitterMs: number | null;
  /** Ida e volta até o servidor de mídia em ms (null quando não informa). */
  rttMs: number | null;
  /** Quando o resumo foi tirado (ISO). */
  collectedAt: string;
}

/** Forma mínima de uma entrada de `RTCStatsReport` que o resumo consulta. */
type StatsEntry = Record<string, unknown>;

/** `RTCStatsReport` é um Map (iterar dá `[id, stats]`); aceitamos também uma lista de entradas. */
export type StatsReportLike = Iterable<StatsEntry> | { values(): Iterable<StatsEntry> };

function entriesOf(report: StatsReportLike): Iterable<StatsEntry> {
  return 'values' in report && typeof report.values === 'function' ? report.values() : (report as Iterable<StatsEntry>);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Resume um `RTCStatsReport` (qualquer iterável de entradas) nos números que
 * importam para avaliar a qualidade do áudio. Devolve `null` quando não há
 * fluxo de áudio recebido (ligação que nunca conectou mídia).
 */
export function summarizeRtcStats(
  report: StatsReportLike | null | undefined,
  now: Date = new Date(),
): WebphoneAudioStats | null {
  if (!report) return null;

  let inbound: StatsEntry | null = null;
  let rttSeconds: number | null = null;
  let fallbackRtt: number | null = null;

  for (const entry of entriesOf(report)) {
    if (!entry || typeof entry !== 'object') continue;
    const type = entry.type;
    if (type === 'inbound-rtp' && (entry.kind === 'audio' || entry.mediaType === 'audio' || entry.kind === undefined)) {
      // Com mais de um fluxo de áudio (raro em voz), fica o que recebeu mais.
      if (!inbound || (num(entry.packetsReceived) ?? 0) > (num(inbound.packetsReceived) ?? 0)) inbound = entry;
    } else if (type === 'candidate-pair') {
      const rtt = num(entry.currentRoundTripTime);
      if (rtt === null) continue;
      if (entry.nominated === true || entry.state === 'succeeded') rttSeconds = rtt;
      else fallbackRtt ??= rtt;
    } else if (type === 'remote-inbound-rtp') {
      const rtt = num(entry.roundTripTime);
      if (rtt !== null) fallbackRtt ??= rtt;
    }
  }

  if (!inbound) return null;

  const packetsReceived = Math.max(0, Math.floor(num(inbound.packetsReceived) ?? 0));
  const packetsLost = Math.max(0, Math.floor(num(inbound.packetsLost) ?? 0));
  const total = packetsReceived + packetsLost;
  const jitter = num(inbound.jitter);
  const rtt = rttSeconds ?? fallbackRtt;

  return {
    packetsReceived,
    packetsLost,
    lossPercent: total > 0 ? round1((packetsLost / total) * 100) : 0,
    jitterMs: jitter === null ? null : round1(jitter * 1000),
    rttMs: rtt === null ? null : Math.round(rtt * 1000),
    collectedAt: now.toISOString(),
  };
}

export type AudioQualityVerdict = 'good' | 'fair' | 'poor';

/** Leitura rápida para a UI: perda > 5% ou jitter > 50 ms é ruim; > 2% / > 30 ms é regular. */
export function audioQualityVerdict(stats: WebphoneAudioStats | null): AudioQualityVerdict | null {
  if (!stats) return null;
  const jitter = stats.jitterMs ?? 0;
  if (stats.lossPercent > 5 || jitter > 50) return 'poor';
  if (stats.lossPercent > 2 || jitter > 30) return 'fair';
  return 'good';
}
