/**
 * Detects a reconcile run that "succeeded" without pulling anything.
 *
 * The API4COM reconcile worker (`reconcile-api4com-calls`, pg_cron jobid 46)
 * wrote `last_status: success` with `fetched: 0` on every run from
 * 2026-05-19 to 2026-09-10 (timezone bug in the REST filter). The health
 * check only looked at `last_success_at`, so nobody noticed for 4 months.
 *
 * Rule: in Brazilian business hours, an org with `fetched: 0` and no errors
 * on the last run is suspicious when the dialer registered at least
 * MIN_DIALER_CALLS calls for that org inside the run's window. The evidence
 * requirement avoids false alarms on holidays or idle days.
 */

export const ZERO_FETCH_MIN_DIALER_CALLS = 5;
// Calls still ringing (or just hung up) may not be in the REST listing yet —
// ignore the tail of the window when counting dialer evidence.
export const ZERO_FETCH_EVIDENCE_TAIL_MINUTES = 10;

const BUSINESS_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18; // exclusive

/** Monday–Friday, 08:00–17:59 in São Paulo time. */
export function isBrazilBusinessHours(date: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return BUSINESS_DAYS.has(weekday) && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}

export interface ReconcileRunState {
  last_run_at: string | null;
  metadata: unknown;
}

export interface ZeroFetchCandidate {
  orgId: string;
  /** Window where dialer calls should have been fetched (real UTC ISO). */
  evidenceSince: string;
  evidenceUntil: string;
}

interface RunMetadata {
  windowHours?: unknown;
  orgs?: unknown;
}

interface RunOrg {
  org_id?: unknown;
  fetched?: unknown;
  errors?: unknown;
}

/**
 * Orgs from the last reconcile run that came back empty without errors, with
 * the window to look for dialer evidence. Empty when the run happened outside
 * business hours or the stored state is malformed.
 */
export function findZeroFetchCandidates(state: ReconcileRunState | null): ZeroFetchCandidate[] {
  if (!state?.last_run_at) return [];
  const runAt = new Date(state.last_run_at);
  if (Number.isNaN(runAt.getTime()) || !isBrazilBusinessHours(runAt)) return [];

  const meta = (state.metadata ?? {}) as RunMetadata;
  const windowHours = typeof meta.windowHours === 'number' && meta.windowHours > 0 ? meta.windowHours : null;
  if (windowHours === null || !Array.isArray(meta.orgs)) return [];

  const evidenceSince = new Date(runAt.getTime() - windowHours * 3_600_000).toISOString();
  const evidenceUntil = new Date(runAt.getTime() - ZERO_FETCH_EVIDENCE_TAIL_MINUTES * 60_000).toISOString();

  return (meta.orgs as RunOrg[])
    .filter((o) => typeof o.org_id === 'string' && o.fetched === 0 && (o.errors ?? 0) === 0)
    .map((o) => ({ orgId: o.org_id as string, evidenceSince, evidenceUntil }));
}
