import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { CRITICAL_WORKERS } from '@/lib/workers/critical-workers';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';
import {
  findZeroFetchCandidates,
  ZERO_FETCH_MIN_DIALER_CALLS,
  type ReconcileRunState,
} from '@/features/integrations/services/api4com-reconcile-health';

export const maxDuration = 60;

const ALERT_COOLDOWN_HOURS = 24;

const RECONCILE_JOB = 'reconcile-api4com-calls';
const ZERO_FETCH_RESOURCE_ID = `${RECONCILE_JOB}:zero-fetch`;

type SupabaseService = ReturnType<typeof createServiceRoleClient>;

async function hasRecentAlert(
  supabase: SupabaseService,
  orgId: string,
  resourceId: string,
  cooldownCutoff: string,
): Promise<boolean> {
  const { data } = (await from(supabase, 'notifications')
    .select('id')
    .eq('org_id', orgId)
    .eq('type', 'integration_error')
    .eq('resource_type', 'worker')
    .eq('resource_id', resourceId)
    .gte('created_at', cooldownCutoff)
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };
  return data !== null;
}

function formatBrtTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * A reconcile run can "succeed" with `fetched: 0` while the dialer kept
 * calling — that hid a 4-month outage (2026-05-19 → 2026-09-10). In business
 * hours, alert the org's managers when the last run pulled nothing for an
 * org that has dialer calls in the same window. See api4com-reconcile-health.ts.
 */
async function checkReconcileZeroFetch(supabase: SupabaseService, cooldownCutoff: string) {
  const { data: state } = (await from(supabase, 'worker_run_state' as never)
    .select('last_run_at, metadata')
    .eq('job_name', RECONCILE_JOB)
    .maybeSingle()) as { data: ReconcileRunState | null };

  const results: Array<{ org_id: string; dialer_calls: number; suspect: boolean; alerted: boolean }> = [];

  for (const candidate of findZeroFetchCandidates(state)) {
    const { count } = (await from(supabase, 'calls')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', candidate.orgId)
      .like('metadata->>gateway', 'flux-%')
      .gte('started_at', candidate.evidenceSince)
      .lte('started_at', candidate.evidenceUntil)) as { count: number | null };

    const dialerCalls = count ?? 0;
    const suspect = dialerCalls >= ZERO_FETCH_MIN_DIALER_CALLS;
    let alerted = false;

    if (suspect && !(await hasRecentAlert(supabase, candidate.orgId, ZERO_FETCH_RESOURCE_ID, cooldownCutoff))) {
      await createNotificationsForOrgMembers({
        orgId: candidate.orgId,
        type: 'integration_error',
        title: 'Conferência de ligações da API4COM sem retorno',
        body: `A conferência das ${formatBrtTime(state!.last_run_at!)} não trouxe nenhuma ligação da API4COM, mas o discador registrou ${dialerCalls} ligações no período. As métricas de ligação podem ficar incompletas até isso ser verificado.`,
        resourceType: 'worker',
        resourceId: ZERO_FETCH_RESOURCE_ID,
        metadata: {
          job_name: RECONCILE_JOB,
          last_run_at: state?.last_run_at ?? null,
          dialer_calls: dialerCalls,
          evidence_since: candidate.evidenceSince,
          evidence_until: candidate.evidenceUntil,
        },
        roleFilter: 'manager',
      }).catch((err: unknown) => console.error('[health-check] zero-fetch notification failed:', err));
      alerted = true;
    }

    results.push({ org_id: candidate.orgId, dialer_calls: dialerCalls, suspect, alerted });
  }

  return results;
}

/**
 * Detects background workers that haven't completed successfully in a while.
 * For each registered worker we check `worker_run_state.last_success_at` and
 * if it's older than `stale_after_hours` (or null) we notify org managers.
 *
 * Notifications are deduplicated against the last 24h so a stuck worker
 * doesn't spam the bell every 2h.
 *
 * GET/POST /api/cron/health-check-workers
 * Auth: Bearer <CRON_SECRET>
 */
async function handle(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - ALERT_COOLDOWN_HOURS * 3_600_000).toISOString();

  const summary: Array<{ job: string; status: string; hours_since_success: number | null; alerted: boolean }> = [];

  for (const worker of CRITICAL_WORKERS) {
    if (worker.expectedAt && !worker.expectedAt(now)) {
      summary.push({ job: worker.job_name, status: 'off_hours', hours_since_success: null, alerted: false });
      continue;
    }

    const { data: state } = (await from(supabase, 'worker_run_state' as never)
      .select('last_run_at, last_success_at, last_status')
      .eq('job_name', worker.job_name)
      .maybeSingle()) as {
      data: { last_run_at: string | null; last_success_at: string | null; last_status: string | null } | null;
    };

    if (!state && !worker.alertWhenNeverRan) {
      // Just deployed, or recording is broken. Tell the team (not customers):
      // if this keeps showing up, the worker is running unwatched.
      Sentry.captureMessage(`[health-check] worker ${worker.job_name} has no run state yet`, {
        level: 'warning',
        tags: { worker: worker.job_name },
        fingerprint: ['worker-not-tracked', worker.job_name],
      });
      summary.push({ job: worker.job_name, status: 'not_tracked_yet', hours_since_success: null, alerted: false });
      continue;
    }

    const lastSuccessAt = state?.last_success_at ? new Date(state.last_success_at) : null;
    const hoursSinceSuccess = lastSuccessAt
      ? (now.getTime() - lastSuccessAt.getTime()) / 3_600_000
      : null;

    const isStale =
      hoursSinceSuccess === null || hoursSinceSuccess > worker.stale_after_hours;

    if (!isStale) {
      summary.push({
        job: worker.job_name,
        status: 'healthy',
        hours_since_success: hoursSinceSuccess,
        alerted: false,
      });
      continue;
    }

    // Stale worker. Tell the team (Sentry, every check) and the org managers
    // (bell, once per cooldown window).
    Sentry.captureMessage(`[health-check] worker ${worker.job_name} stale`, {
      level: 'error',
      tags: { worker: worker.job_name },
      fingerprint: ['worker-stale', worker.job_name],
      extra: {
        hours_since_success: hoursSinceSuccess,
        last_run_at: state?.last_run_at ?? null,
        last_status: state?.last_status ?? null,
      },
    });

    // Iterate all orgs because the cron is global; each org's managers see
    // their own notification regardless of whether the worker's failure was
    // org-specific.
    let orgIds: string[];
    if (worker.notifyOrgIds) {
      orgIds = await worker.notifyOrgIds(supabase);
    } else {
      const { data: orgs } = (await from(supabase, 'organizations')
        .select('id')) as { data: Array<{ id: string }> | null };
      orgIds = (orgs ?? []).map((o) => o.id);
    }

    let alertedThisRun = false;
    for (const orgId of orgIds) {
      const { data: recentNotif } = (await from(supabase, 'notifications')
        .select('id')
        .eq('org_id', orgId)
        .eq('type', 'integration_error')
        .eq('resource_type', 'worker')
        .eq('resource_id', worker.job_name)
        .gte('created_at', cooldownCutoff)
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (recentNotif) continue;

      await createNotificationsForOrgMembers({
        orgId: orgId,
        type: 'integration_error',
        title: `${worker.label} parado`,
        body: hoursSinceSuccess !== null
          ? `${worker.label} está sem rodar com sucesso há ${hoursSinceSuccess.toFixed(1)}h. ${worker.impact} O time técnico já foi avisado.`
          : `${worker.label} nunca rodou com sucesso. ${worker.impact} O time técnico já foi avisado.`,
        resourceType: 'worker',
        resourceId: worker.job_name,
        metadata: {
          job_name: worker.job_name,
          last_run_at: state?.last_run_at ?? null,
          last_success_at: state?.last_success_at ?? null,
          last_status: state?.last_status ?? null,
        },
        roleFilter: 'manager',
      }).catch((err: unknown) => console.error('[health-check] notification failed:', err));

      alertedThisRun = true;
    }

    summary.push({
      job: worker.job_name,
      status: 'stale',
      hours_since_success: hoursSinceSuccess,
      alerted: alertedThisRun,
    });
  }

  const zeroFetch = await checkReconcileZeroFetch(supabase, cooldownCutoff);

  return NextResponse.json({ checked_at: now.toISOString(), summary, zero_fetch: zeroFetch });
}

export const POST = handle;
export const GET = handle;
