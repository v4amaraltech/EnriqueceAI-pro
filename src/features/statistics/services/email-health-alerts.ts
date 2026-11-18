/**
 * Mailbox alerts of the e-mail health panel (story email-engine-health-panel,
 * AC 8–9), run by the health-check-workers cron every 2h:
 *   - Gmail connection in `status='error'` → owner + org managers;
 *   - mailbox with bounce above 5% (≥ 30 leads, last 7 days) → org managers.
 * Each alert repeats at most once per 24h per mailbox, deduplicated against the
 * `notifications` table (no migration), like the worker alerts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import {
  createNotification,
  createNotificationsForOrgMembers,
} from '@/features/notifications/services/notification.service';

import {
  attributeMailboxes,
  BOUNCE_CRITICAL_PCT,
  BOUNCE_MIN_LEADS,
  bounceLevel,
  bounceRatePct,
  computeMailboxStats,
} from './email-health.logic';
import { readEmailHealthRows } from './email-health.service';

export const MAILBOX_RESOURCE_TYPE = 'mailbox';
const BOUNCE_WINDOW_DAYS = 7;

interface AlertConnection {
  id: string;
  org_id: string;
  user_id: string;
  email_address: string;
  status: string;
  paused_reason: string | null;
}

export interface MailboxAlertSummary {
  disconnected: Array<{ connection_id: string; alerted: boolean }>;
  high_bounce: Array<{ connection_id: string; rate: number; leads: number; alerted: boolean }>;
}

export const disconnectedResourceId = (connectionId: string) => `${connectionId}:disconnected`;
export const bounceResourceId = (connectionId: string) => `${connectionId}:bounce`;

async function hasRecentMailboxAlert(
  supabase: SupabaseClient,
  orgId: string,
  resourceId: string,
  cooldownCutoff: string,
): Promise<boolean> {
  const { data } = (await from(supabase, 'notifications')
    .select('id')
    .eq('org_id', orgId)
    .eq('resource_type', MAILBOX_RESOURCE_TYPE)
    .eq('resource_id', resourceId)
    .gte('created_at', cooldownCutoff)
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };
  return data !== null;
}

export async function checkMailboxAlerts(
  supabase: SupabaseClient,
  now: Date,
  cooldownCutoff: string,
): Promise<MailboxAlertSummary> {
  const { data: connections, error } = (await from(supabase, 'gmail_connections')
    .select('id, org_id, user_id, email_address, status, paused_reason')
    .in('status', ['connected', 'error'])) as { data: AlertConnection[] | null; error: { message: string } | null };
  if (error) throw new Error(`mailbox alerts: ${error.message}`);

  const summary: MailboxAlertSummary = { disconnected: [], high_bounce: [] };
  const all = connections ?? [];

  // AC 8 — Gmail desconectado.
  for (const conn of all.filter((c) => c.status === 'error')) {
    const resourceId = disconnectedResourceId(conn.id);
    if (await hasRecentMailboxAlert(supabase, conn.org_id, resourceId, cooldownCutoff)) {
      summary.disconnected.push({ connection_id: conn.id, alerted: false });
      continue;
    }
    const title = `Gmail desconectado: ${conn.email_address}`;
    const body = `O Gmail de ${conn.email_address} desconectou — os e-mails automáticos dessa caixa estão parados. Reconecte em Configurações › Integrações.`;
    const metadata = { connection_id: conn.id, email_address: conn.email_address, alert: 'gmail_disconnected' };

    await createNotification({
      org_id: conn.org_id,
      user_id: conn.user_id,
      type: 'integration_error',
      title,
      body,
      resource_type: MAILBOX_RESOURCE_TYPE,
      resource_id: resourceId,
      metadata,
    }).catch((err: unknown) => console.error('[mailbox-alerts] owner notification failed:', err));
    await createNotificationsForOrgMembers({
      orgId: conn.org_id,
      type: 'integration_error',
      title,
      body,
      resourceType: MAILBOX_RESOURCE_TYPE,
      resourceId,
      metadata,
      roleFilter: 'manager',
      excludeUserId: conn.user_id,
    }).catch((err: unknown) => console.error('[mailbox-alerts] manager notification failed:', err));
    summary.disconnected.push({ connection_id: conn.id, alerted: true });
  }

  // AC 9 — bounce alto (só caixas não pausadas; a do BDR já se pausa sozinha).
  const active = all.filter((c) => !c.paused_reason);
  const byOrg = new Map<string, AlertConnection[]>();
  for (const conn of active) byOrg.set(conn.org_id, [...(byOrg.get(conn.org_id) ?? []), conn]);

  const start = new Date(now.getTime() - BOUNCE_WINDOW_DAYS * 86_400_000).toISOString();
  for (const [orgId, conns] of byOrg) {
    const rows = await readEmailHealthRows(supabase, orgId, start, now.toISOString());
    const stats = computeMailboxStats(attributeMailboxes(rows));
    for (const conn of conns) {
      const s = stats.get(conn.user_id);
      if (!s || bounceLevel(s.bouncedLeads, s.emailedLeads) !== 'critical') continue;
      const rate = bounceRatePct(s.bouncedLeads, s.emailedLeads);
      const resourceId = bounceResourceId(conn.id);
      if (await hasRecentMailboxAlert(supabase, orgId, resourceId, cooldownCutoff)) {
        summary.high_bounce.push({ connection_id: conn.id, rate, leads: s.emailedLeads, alerted: false });
        continue;
      }
      await createNotificationsForOrgMembers({
        orgId,
        type: 'integration_error',
        title: `Bounce alto: ${conn.email_address}`,
        body: `${rate}% dos leads que receberam e-mail de ${conn.email_address} nos últimos ${BOUNCE_WINDOW_DAYS} dias deram bounce (${s.bouncedLeads} de ${s.emailedLeads}; limite ${BOUNCE_CRITICAL_PCT}%, mínimo ${BOUNCE_MIN_LEADS} leads). Isso prejudica a entrega dos e-mails. Veja Estatísticas › Saúde do e-mail.`,
        resourceType: MAILBOX_RESOURCE_TYPE,
        resourceId,
        metadata: {
          connection_id: conn.id,
          email_address: conn.email_address,
          alert: 'high_bounce',
          bounce_rate: rate,
          bounced_leads: s.bouncedLeads,
          emailed_leads: s.emailedLeads,
        },
        roleFilter: 'manager',
      }).catch((err: unknown) => console.error('[mailbox-alerts] bounce notification failed:', err));
      summary.high_bounce.push({ connection_id: conn.id, rate, leads: s.emailedLeads, alerted: true });
    }
  }

  return summary;
}
