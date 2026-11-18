import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';
import { brtDateKey } from '@/lib/utils/br-holidays';
import { formatDateLabel } from '@/lib/utils/format';
import { isUuid } from '@/lib/utils/uuid';
import { CRITICAL_WORKERS } from '@/lib/workers/critical-workers';

import type { EmailHealthData, EngineNow, MailboxHealthRow, MailboxStatus } from '../types/email-health.types';
import {
  attributeMailboxes,
  bounceLevel,
  bounceRatePct,
  brtDay,
  buildHealthTrend,
  computeMailboxStats,
  type EmailHealthRow,
  groupFailureReasons,
  inSendingHours,
  isAutoEmailStep,
  lastBusinessDays,
  OVERDUE_GRACE_MINUTES,
  UNKNOWN_MAILBOX,
  workerHealth,
} from './email-health.logic';
import { readAllRows } from './read-all-rows';

const TREND_DAYS = 14;
const ENGINE_JOBS = ['execute-cadence-steps', 'check-email-replies'];

const HEALTH_SELECT =
  'type, lead_id, cadence_id, created_at, external_id, performed_by, manual_send:metadata->>manual_send, meeting_reminder:metadata->>meeting_reminder, source:metadata->>source, sender_user_id:metadata->>sender_user_id, error:metadata->>error, reason:metadata->>reason';

interface ConnectionRow {
  id: string;
  user_id: string;
  email_address: string;
  status: string;
  daily_cap: number | null;
  paused_reason: string | null;
}

/** Prospecting e-mail interactions of the org in [start, end] (paginated). */
export async function readEmailHealthRows(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
  cadenceId?: string,
): Promise<EmailHealthRow[]> {
  return readAllRows<EmailHealthRow>('saúde do e-mail: interações', () => {
    let q = from(supabase, 'interactions')
      .select(HEALTH_SELECT)
      .eq('org_id', orgId)
      .eq('channel', 'email')
      .in('type', ['sent', 'failed', 'bounced', 'replied'])
      .not('cadence_id', 'is', null)
      .gte('created_at', start)
      .lte('created_at', end);
    if (isUuid(cadenceId)) q = q.eq('cadence_id', cadenceId);
    return q.order('created_at', { ascending: true }).order('id', { ascending: true });
  });
}

function mailboxStatus(conn: ConnectionRow | undefined): MailboxStatus {
  if (!conn) return 'unknown';
  if (conn.paused_reason) return 'paused';
  if (conn.status === 'error') return 'reconnect';
  return 'connected';
}

/**
 * E-mail health panel data.
 *
 * `supabase` is the manager's client (interactions, enrollments: RLS-scoped).
 * `service` is the service-role client, used only for rows a manager can't read
 * through RLS: other users' `gmail_connections` (non-secret columns only) and
 * `worker_run_state`. The caller must have checked the manager role first.
 */
export async function fetchEmailHealthData(
  supabase: SupabaseClient,
  service: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
  now: Date = new Date(),
): Promise<EmailHealthData> {
  const trendDays = lastBusinessDays(TREND_DAYS, now);
  const firstTrendDay = trendDays[0] ?? brtDateKey(now);
  const trendStart = `${firstTrendDay}T03:00:00Z`;
  const queryStart = trendStart < periodStart ? trendStart : periodStart;
  const nowIso = now.toISOString();
  const queryEnd = nowIso > periodEnd ? nowIso : periodEnd;

  const [rawRows, connections, engine] = await Promise.all([
    readEmailHealthRows(supabase, orgId, queryStart, queryEnd, cadenceId),
    readConnections(service, orgId),
    fetchEngineNow(supabase, service, orgId, now),
  ]);

  const ownerFilter = userIds && userIds.length > 0 ? new Set(userIds) : null;
  const all = attributeMailboxes(rawRows);
  const scoped = ownerFilter ? all.filter((r) => ownerFilter.has(r.mailbox)) : all;

  const periodRows = scoped.filter((r) => r.created_at >= periodStart && r.created_at <= periodEnd);
  const trendRows = scoped.filter((r) => r.created_at >= trendStart);
  const today = brtDateKey(now);

  const stats = computeMailboxStats(periodRows);
  const sentToday = new Map<string, number>();
  for (const row of all) {
    if (row.type === 'sent' && brtDay(row.created_at) === today) {
      sentToday.set(row.mailbox, (sentToday.get(row.mailbox) ?? 0) + 1);
    }
  }

  const connByUser = new Map(connections.map((c) => [c.user_id, c]));
  const keys = new Set<string>(connections.map((c) => c.user_id));
  for (const key of stats.keys()) keys.add(key);
  const profiles = await resolveUserProfiles([...keys].filter((k) => k !== UNKNOWN_MAILBOX));

  const mailboxes: MailboxHealthRow[] = [];
  for (const key of keys) {
    if (ownerFilter && !ownerFilter.has(key)) continue;
    const s = stats.get(key);
    const conn = connByUser.get(key);
    if (key === UNKNOWN_MAILBOX && !s) continue;
    const profile = profiles.get(key);
    mailboxes.push({
      key,
      email:
        key === UNKNOWN_MAILBOX
          ? 'Caixa não identificada'
          : conn?.email_address ?? profile?.email ?? 'Sem Gmail conectado',
      ownerName: key === UNKNOWN_MAILBOX ? '—' : profile?.displayName ?? key.slice(0, 8),
      status: key === UNKNOWN_MAILBOX ? 'unknown' : mailboxStatus(conn),
      pausedReason: conn?.paused_reason ?? null,
      sentToday: sentToday.get(key) ?? 0,
      dailyCap: conn?.daily_cap ?? null,
      sent: s?.sent ?? 0,
      emailedLeads: s?.emailedLeads ?? 0,
      bouncedLeads: s?.bouncedLeads ?? 0,
      bounceRate: bounceRatePct(s?.bouncedLeads ?? 0, s?.emailedLeads ?? 0),
      bounceLevel: bounceLevel(s?.bouncedLeads ?? 0, s?.emailedLeads ?? 0),
      repliedLeads: s?.repliedLeads ?? 0,
      failed: s?.failed ?? 0,
      lastSentAt: s?.lastSentAt ?? null,
    });
  }
  // Problems first, then volume.
  const statusRank: Record<MailboxStatus, number> = { reconnect: 0, paused: 1, connected: 2, unknown: 3 };
  mailboxes.sort(
    (a, b) => statusRank[a.status] - statusRank[b.status] || b.sent - a.sent || a.email.localeCompare(b.email),
  );

  return {
    engine,
    mailboxes,
    trend: buildHealthTrend(trendRows, trendDays, formatDateLabel),
    failureReasons: groupFailureReasons(periodRows),
  };
}

async function readConnections(service: SupabaseClient, orgId: string): Promise<ConnectionRow[]> {
  const { data, error } = (await from(service, 'gmail_connections')
    .select('id, user_id, email_address, status, daily_cap, paused_reason')
    .eq('org_id', orgId)) as { data: ConnectionRow[] | null; error: { message: string } | null };
  if (error) throw new Error(`saúde do e-mail: caixas — ${error.message}`);
  return data ?? [];
}

/** "Motor agora" block: robots, today's sends/failures and overdue automatic steps. Ignores filters. */
async function fetchEngineNow(
  supabase: SupabaseClient,
  service: SupabaseClient,
  orgId: string,
  now: Date,
): Promise<EngineNow> {
  const today = brtDateKey(now);
  const [states, todayRows, overdue] = await Promise.all([
    from(service, 'worker_run_state' as never)
      .select('job_name, last_success_at')
      .in('job_name', ENGINE_JOBS) as unknown as Promise<{
      data: Array<{ job_name: string; last_success_at: string | null }> | null;
    }>,
    readEmailHealthRows(supabase, orgId, `${today}T03:00:00Z`, now.toISOString()),
    fetchOverdueAutoEmail(supabase, orgId, now),
  ]);

  const lastSuccess = new Map((states.data ?? []).map((s) => [s.job_name, s.last_success_at]));
  const workers = ENGINE_JOBS.map((job) => {
    const worker = CRITICAL_WORKERS.find((w) => w.job_name === job);
    return workerHealth(
      worker ?? { job_name: job, label: job, stale_after_hours: 1 },
      lastSuccess.get(job) ?? null,
      now,
    );
  });

  const attributed = attributeMailboxes(todayRows);
  return {
    workers,
    sentToday: attributed.filter((r) => r.type === 'sent').length,
    failedToday: attributed.filter((r) => r.type === 'failed').length,
    overdueCount: overdue.count,
    oldestOverdueAt: overdue.oldest,
    inSendingHours: inSendingHours(now),
  };
}

interface DueEnrollment {
  cadence_id: string;
  current_step: number | null;
  next_step_due: string;
  cadence: { org_id: string; type: string | null } | null;
}

/** Active enrollments whose current step is an automatic e-mail due more than 30 min ago. */
async function fetchOverdueAutoEmail(
  supabase: SupabaseClient,
  orgId: string,
  now: Date,
): Promise<{ count: number; oldest: string | null }> {
  const cutoff = new Date(now.getTime() - OVERDUE_GRACE_MINUTES * 60_000).toISOString();
  const enrollments = await readAllRows<DueEnrollment>('saúde do e-mail: inscrições vencidas', () =>
    from(supabase, 'cadence_enrollments')
      .select('cadence_id, current_step, next_step_due, cadence:cadences!inner(org_id, type, deleted_at)')
      .eq('status', 'active')
      .eq('cadence.org_id', orgId)
      .is('cadence.deleted_at', null)
      .lt('next_step_due', cutoff)
      .order('next_step_due', { ascending: true })
      .order('id', { ascending: true }),
  );
  if (enrollments.length === 0) return { count: 0, oldest: null };

  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];
  const steps = await chunkedIn<{ cadence_id: string; step_order: number; channel: string; auto_send: boolean | null }>(
    cadenceIds,
    async (chunk) =>
      (await from(supabase, 'cadence_steps')
        .select('cadence_id, step_order, channel, auto_send')
        .in('cadence_id', chunk)) as {
        data: Array<{ cadence_id: string; step_order: number; channel: string; auto_send: boolean | null }> | null;
        error: { message: string } | null;
      },
  );
  const stepByKey = new Map(steps.map((s) => [`${s.cadence_id}|${s.step_order}`, s]));

  let count = 0;
  let oldest: string | null = null;
  for (const e of enrollments) {
    const step = stepByKey.get(`${e.cadence_id}|${e.current_step}`);
    if (!step || !isAutoEmailStep(e.cadence?.type ?? null, step)) continue;
    count++;
    if (!oldest || e.next_step_due < oldest) oldest = e.next_step_due;
  }
  return { count, oldest };
}
