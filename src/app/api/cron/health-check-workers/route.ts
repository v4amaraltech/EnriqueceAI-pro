import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

export const maxDuration = 60;

interface CriticalWorker {
  job_name: string;
  // max age (hours) before we consider the worker stuck
  stale_after_hours: number;
  // human label for the notification
  label: string;
}

const CRITICAL_WORKERS: CriticalWorker[] = [
  {
    job_name: 'reconcile-api4com-calls',
    stale_after_hours: 3, // cron runs hourly, alert at 3 misses
    label: 'Reconciliação de ligações API4COM',
  },
];

const ALERT_COOLDOWN_HOURS = 24;

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
    const { data: state } = (await from(supabase, 'worker_run_state' as never)
      .select('last_run_at, last_success_at, last_status')
      .eq('job_name', worker.job_name)
      .maybeSingle()) as {
      data: { last_run_at: string | null; last_success_at: string | null; last_status: string | null } | null;
    };

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

    // Stale worker. Notify org managers — but only once per cooldown window.
    // Iterate all orgs because the cron is global; each org's managers see
    // their own notification regardless of whether the worker's failure was
    // org-specific.
    const { data: orgs } = (await from(supabase, 'organizations')
      .select('id')) as { data: Array<{ id: string }> | null };

    let alertedThisRun = false;
    for (const org of orgs ?? []) {
      const { data: recentNotif } = (await from(supabase, 'notifications')
        .select('id')
        .eq('org_id', org.id)
        .eq('type', 'integration_error')
        .eq('resource_type', 'worker')
        .eq('resource_id', worker.job_name)
        .gte('created_at', cooldownCutoff)
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (recentNotif) continue;

      await createNotificationsForOrgMembers({
        orgId: org.id,
        type: 'integration_error',
        title: `${worker.label} parado`,
        body: hoursSinceSuccess !== null
          ? `O worker "${worker.job_name}" não completa com sucesso há ${hoursSinceSuccess.toFixed(1)}h. Métricas podem ficar desatualizadas até ser restaurado.`
          : `O worker "${worker.job_name}" nunca completou com sucesso. Verifique a configuração da integração.`,
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

  return NextResponse.json({ checked_at: now.toISOString(), summary });
}

export const POST = handle;
export const GET = handle;
