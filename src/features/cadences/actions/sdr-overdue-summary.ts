'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { createNotification } from '@/features/notifications/services/notification.service';

/**
 * Daily summary alert for SDRs whose cadence enrollments are overdue on a
 * manual channel (whatsapp / phone / research / linkedin). Email steps
 * auto-execute via the cron and never linger here.
 *
 * One notification per SDR per day. Dedup keys off metadata.alert_type
 * + the BRT date.
 */
interface OverdueRow {
  lead_id: string;
  assigned_to: string | null;
  org_id: string;
  channel: string;
}

export async function notifyOverdueActivities(): Promise<ActionResult<{ notified: number }>> {
  const supabase = createServiceRoleClient();

  // Pull active enrollments overdue >24h, joined to the lead's owner and the
  // current step's channel. Skipping email — the cadence executor cron
  // handles those automatically.
  const { data: rows, error } = (await (supabase.rpc as never as (fn: string) => Promise<{ data: OverdueRow[] | null; error: { message: string } | null }>)(
    'fetch_overdue_manual_activities',
  ));

  if (error) {
    console.error('[sdr-overdue-summary] RPC failed:', error.message);
    return { success: false, error: error.message };
  }
  if (!rows?.length) {
    return { success: true, data: { notified: 0 } };
  }

  // Group by SDR (assigned_to). Skip rows without an owner — those leads
  // need to be assigned before the SDR can act on them.
  const byUser = new Map<
    string,
    { orgId: string; total: number; channels: Map<string, number> }
  >();

  for (const row of rows) {
    if (!row.assigned_to) continue;
    const entry = byUser.get(row.assigned_to) ?? {
      orgId: row.org_id,
      total: 0,
      channels: new Map<string, number>(),
    };
    entry.total++;
    entry.channels.set(row.channel, (entry.channels.get(row.channel) ?? 0) + 1);
    byUser.set(row.assigned_to, entry);
  }

  // BRT date for dedup
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  let notified = 0;

  for (const [userId, entry] of byUser) {
    // Skip if we already alerted this user today
    const { count: existing } = (await from(supabase, 'notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'activity_reminder')
      .gte('created_at', `${today}T03:00:00.000Z`)
      .contains('metadata', { alert_type: 'overdue_summary' })) as { count: number | null };

    if ((existing ?? 0) > 0) continue;

    const channelLabels: Record<string, string> = {
      whatsapp: 'WhatsApp',
      phone: 'Ligação',
      research: 'Pesquisa',
      linkedin: 'LinkedIn',
    };
    const breakdown = Array.from(entry.channels.entries())
      .map(([ch, n]) => `${n} ${channelLabels[ch] ?? ch}`)
      .join(', ');

    await createNotification({
      org_id: entry.orgId,
      user_id: userId,
      type: 'activity_reminder',
      title: `${entry.total} lead${entry.total > 1 ? 's' : ''} esperando sua ação`,
      body: `Você tem ${entry.total} atividade${entry.total > 1 ? 's' : ''} atrasada${entry.total > 1 ? 's' : ''} na fila: ${breakdown}. Acesse "Atividades" para processá-las.`,
      resource_type: 'cadence',
      metadata: { alert_type: 'overdue_summary', total: entry.total, breakdown: Object.fromEntries(entry.channels) },
    });

    notified++;
  }

  console.warn(`[sdr-overdue-summary] Complete: sdrs_with_queue=${byUser.size} notified=${notified}`);
  return { success: true, data: { notified } };
}
