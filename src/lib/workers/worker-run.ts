import * as Sentry from '@sentry/nextjs';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

/** Largest result summary kept in worker_run_state.metadata (bytes of JSON). */
const MAX_METADATA_BYTES = 4_000;

/** Small result summary for metadata (never null — the column is jsonb NOT NULL). */
function summarize(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {};
  try {
    if (JSON.stringify(data).length <= MAX_METADATA_BYTES) return data as Record<string, unknown>;
    // Too big — usually an `errors` list. Keep the counters, collapse the lists.
    const compact: Record<string, unknown> = { truncated: true };
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      compact[k] = Array.isArray(v) ? { count: v.length } : v;
    }
    return JSON.stringify(compact).length <= MAX_METADATA_BYTES ? compact : { truncated: true };
  } catch {
    return {};
  }
}

async function writeRunState(jobName: string, row: Record<string, unknown>): Promise<void> {
  // Best-effort: never fail the worker because the bookkeeping failed — but say
  // so loudly, or the worker silently drops out of the health check.
  const report = (err: unknown) => {
    console.error(`[worker-run] failed to record run state for ${jobName}:`, err);
    Sentry.captureMessage(`[worker-run] failed to record run state for ${jobName}`, {
      level: 'error',
      tags: { worker: jobName },
      fingerprint: ['worker-run-state-write', jobName],
      extra: { error: err instanceof Error ? err.message : err },
    });
  };
  try {
    // supabase-js returns errors instead of throwing.
    const { error } = (await from(createServiceRoleClient(), 'worker_run_state' as never).upsert(
      { job_name: jobName, ...row } as never,
      { onConflict: 'job_name' } as never,
    )) as { error: { message: string } | null };
    if (error) report(error);
  } catch (err) {
    report(err);
  }
}

/** Any worker result shaped like ActionResult (some workers return a looser type). */
type WorkerResult = { success: boolean; data?: unknown; error?: string };

/**
 * Runs a cron worker and records the outcome in `worker_run_state`, which the
 * `health-check-workers` cron watches (it alerts when `last_success_at` gets
 * stale). Failures — a `{ success: false }` result or a thrown error — also go
 * to Sentry tagged with the job name.
 *
 * Why: cron routes caught their errors and answered 500, so nothing reached
 * Sentry (Next's onRequestError only sees uncaught errors) and only one worker
 * was watched. This catches a worker that fails or stops running; a worker that
 * "succeeds" while doing nothing useful still needs its own checks.
 */
export async function runTrackedWorker<R extends WorkerResult>(jobName: string, fn: () => Promise<R>): Promise<R> {
  const startedAt = new Date().toISOString();
  let result: R;
  try {
    result = await fn();
  } catch (err) {
    // Not captured here: it's rethrown uncaught, so instrumentation's
    // onRequestError already reports it (capturing here too doubled every event).
    await writeRunState(jobName, {
      last_run_at: startedAt,
      last_status: 'error',
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  if (result.success) {
    await writeRunState(jobName, {
      last_run_at: startedAt,
      last_success_at: startedAt,
      last_status: 'success',
      metadata: summarize(result.data),
    });
  } else {
    Sentry.captureMessage(`[worker] ${jobName} failed`, {
      level: 'error',
      tags: { worker: jobName },
      // One issue per worker; the varying error text goes in `extra`.
      fingerprint: ['worker-failed', jobName],
      extra: { error: result.error ?? null },
    });
    await writeRunState(jobName, {
      last_run_at: startedAt,
      last_status: 'error',
      metadata: { error: result.error ?? null },
    });
  }
  return result;
}
