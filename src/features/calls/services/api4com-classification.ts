import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type { CallStatus } from '../types';

const DEFAULT_SIGNIFICANT_THRESHOLD_SECONDS = 30;

/**
 * In-memory cache for org-level significant threshold.
 * Both webhook (per-event) and reconcile (per-org-batch) hit the same orgs
 * repeatedly inside a single process — caching avoids one Supabase round-trip
 * per event. TTL keeps the cache fresh enough that an admin changing the
 * threshold in Settings sees it apply within the TTL window.
 */
const thresholdCache = new Map<string, { value: number; expiresAt: number }>();
const THRESHOLD_TTL_MS = 5 * 60 * 1000; // 5min

export async function getSignificantThreshold(
  supabase: SupabaseClient,
  orgId: string,
): Promise<number> {
  const cached = thresholdCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data } = (await from(supabase, 'organization_call_settings')
    .select('significant_threshold_seconds')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { significant_threshold_seconds: number } | null };

  const value = data?.significant_threshold_seconds ?? DEFAULT_SIGNIFICANT_THRESHOLD_SECONDS;
  thresholdCache.set(orgId, { value, expiresAt: Date.now() + THRESHOLD_TTL_MS });
  return value;
}

// Hangup causes that, by themselves, indicate the call did not reach the
// destination user. Used by the REST-fed reconcile (which doesn't have
// answered_at) and as a tiebreaker in the webhook path.
const NOT_CONNECTED_CAUSES = new Set([
  'NO_ANSWER',
  'NO_USER_RESPONSE',
  'USER_BUSY',
  'CALL_REJECTED',
  'UNALLOCATED_NUMBER',
  'INVALID_NUMBER_FORMAT',
  'ORIGINATOR_CANCEL',
  'NORMAL_TEMPORARY_FAILURE',
  'RECOVERY_ON_TIMER_EXPIRE',
  'NUMBER_CHANGED',
]);

const HANGUP_CAUSE_TO_STATUS: Record<string, CallStatus> = {
  NO_ANSWER: 'no_contact',
  NO_USER_RESPONSE: 'no_contact',
  USER_BUSY: 'busy',
  CALL_REJECTED: 'not_connected',
  UNALLOCATED_NUMBER: 'not_connected',
  INVALID_NUMBER_FORMAT: 'not_connected',
  ORIGINATOR_CANCEL: 'not_connected',
  NORMAL_TEMPORARY_FAILURE: 'not_connected',
  RECOVERY_ON_TIMER_EXPIRE: 'not_connected',
  // NUMBER_CHANGED é a 2ª causa mais comum em V4 Amaral (690 em mai/2026)
  // — caía no default 'no_contact' antes deste mapeamento explícito.
  NUMBER_CHANGED: 'not_connected',
};

export interface ClassifyInput {
  /** When non-null, the webhook saw channel-answer — call was definitely connected. */
  answeredAt: string | null;
  /** FreeSWITCH hangup cause (NORMAL_CLEARING, NO_ANSWER, USER_BUSY, ...). */
  hangupCause: string | null;
  /** Talk time in seconds (post-answer). */
  durationSeconds: number;
  /** Org's configured threshold to separate significant (qualified) from short-but-answered. */
  significantThresholdSeconds: number;
}

export interface ClassifyOutput {
  /** True when the call reached the destination user (the dashboard's "atendida"). */
  connected: boolean;
  /** Qualitative bucket — significant / not_significant / busy / no_contact / not_connected. */
  status: CallStatus;
}

/**
 * Single source of truth for API4COM → calls classification.
 *
 * Webhook path: pass answeredAt from the payload — the most authoritative signal.
 * REST path (reconcile): pass answeredAt=null — function derives connected
 * from hangupCause + duration as a proxy.
 */
export function classifyApi4ComCall(input: ClassifyInput): ClassifyOutput {
  const { answeredAt, hangupCause, durationSeconds, significantThresholdSeconds } = input;

  // Authoritative signal from webhook: channel-answer fired.
  const wasAnswered =
    answeredAt !== null
    // REST/reconcile proxy: NORMAL_CLEARING with talk time means the user
    // picked up. API4COM dashboard's "Chamadas Atendidas" metric uses the
    // same rule (validated against May/2026 numbers — 970 connected calls
    // matched this exact predicate within ±5%).
    || (hangupCause === 'NORMAL_CLEARING' && durationSeconds > 0);

  if (wasAnswered) {
    return {
      connected: true,
      status: durationSeconds >= significantThresholdSeconds ? 'significant' : 'not_significant',
    };
  }

  // Not answered — pick the qualitative bucket from hangup cause.
  if (hangupCause && HANGUP_CAUSE_TO_STATUS[hangupCause]) {
    return { connected: false, status: HANGUP_CAUSE_TO_STATUS[hangupCause] };
  }
  if (hangupCause && NOT_CONNECTED_CAUSES.has(hangupCause)) {
    return { connected: false, status: 'not_connected' };
  }

  // Default for unknown or missing hangup_cause.
  return { connected: false, status: 'no_contact' };
}

// Exposed for tests — flushes the in-memory threshold cache.
export function __resetThresholdCacheForTests(): void {
  thresholdCache.clear();
}
