import type { NextActivityResult } from './live-amd-next-activity';

/**
 * Telemetria da captura da escuta (camelCase aqui, snake_case no metadata).
 * rmsAvg e rmsPeak na escala 0 a 1 (amostra int16 / 32768).
 */
export interface LiveAmdTelemetryPatch {
  bytesSent?: number;
  frames?: number;
  rmsAvg?: number;
  rmsPeak?: number;
  audioContextState?: string;
  beginReceived?: boolean;
  turnCount?: number;
  messageCount?: number;
  wsError?: boolean;
  emptyReason?: string | null;
  trackCloned?: boolean | null;
  pump?: string | null;
}

const TELEMETRY_KEYS: ReadonlyArray<[keyof LiveAmdTelemetryPatch, string]> = [
  ['bytesSent', 'bytes_sent'],
  ['frames', 'frames'],
  ['rmsAvg', 'rms_avg'],
  ['rmsPeak', 'rms_peak'],
  ['audioContextState', 'audio_context_state'],
  ['beginReceived', 'begin_received'],
  ['turnCount', 'turn_count'],
  ['messageCount', 'message_count'],
  ['wsError', 'ws_error'],
  ['emptyReason', 'empty_reason'],
  ['trackCloned', 'track_cloned'],
  ['pump', 'pump'],
];

function telemetryFields(telemetry: LiveAmdTelemetryPatch | undefined): Record<string, unknown> {
  if (!telemetry) return {};
  const out: Record<string, unknown> = {};
  for (const [from, to] of TELEMETRY_KEYS) {
    const value = telemetry[from];
    if (value !== undefined) out[to] = value;
  }
  return out;
}

export interface LiveAmdPatch {
  prediction: string;
  phrase: string | null;
  confidence: number;
  latencyMs: number;
  predictedAt: string;
  transcript?: string;
  nextActivity?: NextActivityResult | null;
  telemetry?: LiveAmdTelemetryPatch;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Grava a sugestão dentro de metadata.live_amd e preserva o resto do metadata.
 * Não mexe em sdr_disposition, status nem connected.
 */
export function mergeLiveAmdMetadata(existing: unknown, patch: LiveAmdPatch): Record<string, unknown> {
  const base = isPlain(existing) ? existing : {};
  const prev = isPlain(base.live_amd) ? base.live_amd : {};
  return {
    ...base,
    live_amd: {
      ...prev,
      prediction: patch.prediction,
      phrase: patch.phrase,
      confidence: patch.confidence,
      latency_ms: patch.latencyMs,
      predicted_at: patch.predictedAt,
      ...(patch.transcript !== undefined ? { transcript: patch.transcript } : {}),
      ...telemetryFields(patch.telemetry),
      ...(patch.nextActivity
        ? {
            next_activity_suggestion: patch.nextActivity.suggestion,
            next_activity_reason: patch.nextActivity.reason,
            next_activity_confidence: patch.nextActivity.confidence,
          }
        : {}),
    },
  };
}
