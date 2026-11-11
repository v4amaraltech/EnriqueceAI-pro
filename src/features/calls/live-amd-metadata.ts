import type { NextActivityResult } from './live-amd-next-activity';

export interface LiveAmdPatch {
  prediction: string;
  phrase: string | null;
  confidence: number;
  latencyMs: number;
  predictedAt: string;
  transcript?: string;
  nextActivity?: NextActivityResult | null;
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
