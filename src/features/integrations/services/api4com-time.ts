/**
 * Parse an API4COM timestamp into a real-UTC Date.
 *
 * API4COM ships São Paulo local time across two different formats:
 *
 *   REST /calls (started_at): "2026-05-14T10:00:44.000Z"
 *     ISO with a trailing Z, but the value is BRT not UTC. JS Date.parse
 *     honours the Z and lands 3h earlier than reality.
 *
 *   Webhook payload (startedAt, endedAt): "2026-05-15 11:53:06"
 *     No timezone. JS treats it as the runtime's local TZ, which on
 *     Vercel/Node is UTC, so again 3h earlier than reality.
 *
 * Both shapes need +3h applied to reach real UTC. Doing this in one
 * helper means future TZ changes (DST, region migration) live in a
 * single place.
 *
 * Returns null when the input is empty or malformed — callers should
 * treat that as "we can't compare timestamps for this record" rather
 * than silently dropping rows.
 */
const SAO_PAULO_TO_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export function parseApi4ComTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  // Add a `T` between date and time if the value is the webhook's
  // space-separated shape; otherwise leave the ISO string alone.
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const raw = new Date(normalized).getTime();
  if (Number.isNaN(raw)) return null;
  return new Date(raw + SAO_PAULO_TO_UTC_OFFSET_MS);
}

/**
 * Inverse of parseApi4ComTimestamp: turn a real-UTC Date into the
 * BRT-disguised-as-Z string API4COM compares against in REST filters
 * (`?filter={"where":{"started_at":{...}}}`).
 *
 * Sending real UTC there shifts the window 3h into the future — any window
 * shorter than 3h comes back empty. That kept the hourly reconcile at
 * `fetched: 0` from 2026-05-19 (Loopback filter rollout) to 2026-09-10.
 */
export function toApi4ComFilterTimestamp(date: Date): string {
  return new Date(date.getTime() - SAO_PAULO_TO_UTC_OFFSET_MS).toISOString();
}
