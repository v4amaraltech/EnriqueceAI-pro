// Workers watched by the health-check-workers cron (alerts when a worker's
// worker_run_state.last_success_at gets older than `stale_after_hours`).
// Workers record their runs via runTrackedWorker (./worker-run.ts) or their own
// upsert into worker_run_state.

import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

export interface CriticalWorker {
  job_name: string;
  // max age (hours) before we consider the worker stuck
  stale_after_hours: number;
  // human label for the notification
  label: string;
  /** What breaks for the customer while it's stopped (notification body). */
  impact: string;
  /**
   * Orgs whose managers get the bell notification. Omitted = every org (the
   * worker serves everyone). Orgs that don't use the feature must not be paged.
   */
  notifyOrgIds?: (supabase: SupabaseClient) => Promise<string[]>;
  /**
   * Only check while the worker is supposed to be running (e.g. the cadence
   * engine only runs on weekdays, business hours). Omitted = always.
   */
  expectedAt?: (now: Date) => boolean;
  /**
   * No worker_run_state row yet = alert "never succeeded". Off for workers that
   * only started recording their runs recently, so a deploy doesn't page anyone
   * before the first tracked run.
   */
  alertWhenNeverRan?: boolean;
}

/**
 * Cadence engine cron: `*\/5 11-20 * * 1-5` (UTC) = Mon–Fri 08:00–17:55 BRT.
 * Checked from the 2nd hour of the window on (the health check runs at even UTC
 * hours), so a quiet first hour never looks stale.
 */
export function cadenceEngineExpectedAt(now: Date): boolean {
  const day = now.getUTCDay(); // 0 = Sunday
  const hour = now.getUTCHours();
  return day >= 1 && day <= 5 && hour >= 12 && hour <= 21;
}

const uniq = (ids: Array<string | null | undefined>) => [...new Set(ids.filter((v): v is string => !!v))];

/** Orgs with an active automatic-email cadence (the only ones the engine sends for). */
async function orgsWithActiveAutoEmail(supabase: SupabaseClient): Promise<string[]> {
  const { data } = (await from(supabase, 'cadences')
    .select('org_id')
    .eq('type', 'auto_email')
    .eq('status', 'active')
    .is('deleted_at', null)) as { data: Array<{ org_id: string }> | null };
  return uniq((data ?? []).map((r) => r.org_id));
}

/** Orgs with a connected Gmail (emails whose replies the cron looks for). */
async function orgsWithGmail(supabase: SupabaseClient): Promise<string[]> {
  const { data } = (await from(supabase, 'gmail_connections')
    .select('org_id')
    .in('status', ['connected', 'error'])) as { data: Array<{ org_id: string }> | null };
  return uniq((data ?? []).map((r) => r.org_id));
}

/** Orgs with a BDR IA mailbox (the only ones whose inbox is ingested). */
async function orgsWithBdrMailbox(supabase: SupabaseClient): Promise<string[]> {
  const { data } = (await from(supabase, 'gmail_connections')
    .select('org_id')
    .eq('bdr_ai', true)
    .in('status', ['connected', 'error'])) as { data: Array<{ org_id: string }> | null };
  return uniq((data ?? []).map((r) => r.org_id));
}

export const CRITICAL_WORKERS: CriticalWorker[] = [
  {
    job_name: 'reconcile-api4com-calls',
    stale_after_hours: 3, // cron runs hourly, alert at 3 misses
    label: 'Reconciliação de ligações API4COM',
    impact: 'Métricas de ligação podem ficar desatualizadas até ser restaurado.',
    alertWhenNeverRan: true,
  },
  {
    job_name: 'execute-cadence-steps',
    stale_after_hours: 1, // every 5 min in business hours
    label: 'Envio automático de e-mails das cadências',
    impact: 'Os e-mails automáticos das cadências podem não estar saindo.',
    expectedAt: cadenceEngineExpectedAt,
    notifyOrgIds: orgsWithActiveAutoEmail,
  },
  {
    job_name: 'check-email-replies',
    stale_after_hours: 1, // every 10 min
    label: 'Detecção de respostas de e-mail',
    impact: 'Respostas de leads por e-mail podem não estar sendo detectadas — a cadência pode continuar para quem já respondeu.',
    notifyOrgIds: orgsWithGmail,
  },
  {
    job_name: 'ingest-email-inbox',
    stale_after_hours: 1, // every 5 min
    label: 'Leitura da caixa de e-mail do BDR IA',
    impact: 'E-mails recebidos na caixa do BDR IA podem não estar sendo lidos.',
    notifyOrgIds: orgsWithBdrMailbox,
  },
];
