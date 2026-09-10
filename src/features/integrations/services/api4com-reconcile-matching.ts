/**
 * Matching helpers for the API4COM reconcile worker
 * (`src/app/api/workers/reconcile-api4com-calls/route.ts`).
 *
 * Without webhooks (org V4 Company Julio Cesar, set/2026) every REST call is
 * linked to a dialer row by the origin + destination + ±10min fallback. SDRs
 * redial the same number 2-3 times within minutes, and the old fallback
 * always took the OLDEST row in the window, never skipping rows already
 * linked to another API4COM call, while 10 calls ran in parallel. Result on
 * the 2026-09-10 backfill: several REST calls piled onto the same row
 * (overwriting each other), 648 dialer rows stayed blank and ~34 duplicates
 * were inserted.
 *
 * Fix: process calls to the same ramal + number sequentially in time order
 * (groupCallsForReconcile) and link each one to the CLOSEST row that is not
 * linked yet (pickFallbackCandidate).
 */

interface GroupableCall {
  from?: string;
  to?: string;
  started_at?: string;
}

export interface FallbackCandidate {
  id: string;
  started_at: string | null;
  hangup_cause: string | null;
  metadata: Record<string, unknown> | null;
}

/** Last 8 digits of a phone number — same suffix the fallback query uses. */
export function destinationSuffix(destination: string): string {
  return destination.replace(/\D/g, '').slice(-8);
}

/**
 * Group calls by ramal + destination suffix, each group sorted by started_at
 * ascending. Groups can be processed in parallel; calls inside a group must
 * run one after the other so they never compete for the same dialer row.
 * Calls without from/to can't use the fallback and get a group of their own.
 */
export function groupCallsForReconcile<T extends GroupableCall>(calls: T[]): T[][] {
  const groups = new Map<string, T[]>();
  const singles: T[][] = [];

  for (const c of calls) {
    if (!c.from || !c.to) {
      singles.push([c]);
      continue;
    }
    const key = `${c.from}|${destinationSuffix(c.to)}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const startedMs = (c: T) => (c.started_at ? Date.parse(c.started_at) : 0);
  const sorted = [...groups.values()].map((g) => [...g].sort((a, b) => startedMs(a) - startedMs(b)));
  return [...sorted, ...singles];
}

/**
 * A row already carries an API4COM call when a webhook or a previous
 * reconcile linked it (`webhook_linked`, `alt_api4com_ids`) or when the
 * reconcile itself inserted it. Such rows must not absorb another call.
 */
export function isLinkedToApi4ComCall(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  if (metadata.webhook_linked === true || metadata.webhook_linked === 'true') return true;
  if (metadata.source === 'reconcile_api4com') return true;
  return Array.isArray(metadata.alt_api4com_ids) && metadata.alt_api4com_ids.length > 0;
}

/**
 * Pick the dialer row to link an incoming REST call to: not linked yet,
 * hangup_cause compatible (either side null, or equal), and closest in time.
 * Ties go to the earliest row. Returns null when nothing qualifies — the
 * caller then inserts the call as a new row.
 */
export function pickFallbackCandidate<T extends FallbackCandidate>(
  candidates: T[],
  targetStartedMs: number,
  incomingHangupCause: string | null | undefined,
): T | null {
  let best: T | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestStarted = Number.POSITIVE_INFINITY;

  for (const row of candidates) {
    if (isLinkedToApi4ComCall(row.metadata)) continue;
    if (row.hangup_cause && incomingHangupCause && row.hangup_cause !== incomingHangupCause) continue;
    if (!row.started_at) continue;

    const started = Date.parse(row.started_at);
    if (Number.isNaN(started)) continue;
    const diff = Math.abs(started - targetStartedMs);

    if (diff < bestDiff || (diff === bestDiff && started < bestStarted)) {
      best = row;
      bestDiff = diff;
      bestStarted = started;
    }
  }

  return best;
}
