'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { runMeetingReminders } from '../services/meeting-reminders.service';
import type { ReminderRunSummary } from '../types';

const JOB_NAME = 'meeting-reminders';

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Entry-point do worker de lembretes de reunião (chamado pela rota cron).
 *
 * Toggles por env (piloto = puro toggle, sem deploy):
 * - MEETING_REMINDERS_ENABLED='true' habilita o envio (default: dry-run).
 * - MEETING_REMINDERS_PILOT_USER_IDS='uuid,uuid' restringe a SDRs.
 * - MEETING_REMINDERS_PILOT_CONTEXTS='inbound' restringe a contextos.
 */
export async function runMeetingRemindersJob(): Promise<ActionResult<ReminderRunSummary>> {
  const supabase = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  try {
    const summary = await runMeetingReminders(supabase, {
      enabled: process.env.MEETING_REMINDERS_ENABLED === 'true',
      pilotUserIds: parseList(process.env.MEETING_REMINDERS_PILOT_USER_IDS),
      pilotContexts: parseList(process.env.MEETING_REMINDERS_PILOT_CONTEXTS),
    });

    try {
      await from(supabase, 'worker_run_state' as never).upsert(
        {
          job_name: JOB_NAME,
          last_run_at: nowIso,
          last_status: 'success',
          last_success_at: nowIso,
          metadata: {
            enabled: summary.enabled,
            due: summary.due,
            sent: summary.sent,
            failed: summary.failed,
            skipped: summary.skipped,
          },
        } as never,
        { onConflict: 'job_name' } as never,
      );
    } catch (err) {
      console.warn('[meeting-reminders] failed to write run state:', err);
    }

    return { success: true, data: summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido';
    try {
      await from(supabase, 'worker_run_state' as never).upsert(
        { job_name: JOB_NAME, last_run_at: nowIso, last_status: 'error', metadata: { error: msg } } as never,
        { onConflict: 'job_name' } as never,
      );
    } catch {
      // best-effort
    }
    return { success: false, error: msg };
  }
}
