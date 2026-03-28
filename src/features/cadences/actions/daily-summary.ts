'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { EmailService } from '@/features/integrations/services/email.service';

interface DailyMetrics {
  emails_sent: number;
  emails_failed: number;
  whatsapp_sent: number;
  whatsapp_failed: number;
  enrollments_paused: number;
  enrollments_completed: number;
  active_cadences: number;
}

/** Get today's date range in São Paulo timezone (DST-safe) */
function getTodayRangeBRT(): { start: string; end: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = formatter.format(now); // YYYY-MM-DD in São Paulo tz

  // Calculate UTC offset for São Paulo at this moment (handles DST)
  const spFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const utcFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const spHour = Number(spFormatter.format(now));
  const utcHour = Number(utcFormatter.format(now));
  const offsetHours = ((utcHour - spHour + 24) % 24);

  const padOffset = String(offsetHours).padStart(2, '0');

  // Next day
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextDateStr = formatter.format(nextDay);

  return {
    start: `${dateStr}T${padOffset}:00:00.000Z`,
    end: `${nextDateStr}T${padOffset}:00:00.000Z`,
  };
}

/** Aggregate daily metrics for an organization */
async function getOrgDailyMetrics(supabase: SupabaseClient, orgId: string, start: string, end: string): Promise<DailyMetrics> {
  // Count interactions by type and channel
  const { data: interactions } = (await from(supabase, 'interactions')
    .select('type, channel')
    .eq('org_id', orgId)
    .gte('created_at', start)
    .lte('created_at', end)) as { data: Array<{ type: string; channel: string }> | null };

  const items = interactions ?? [];

  const emails_sent = items.filter((i) => i.channel === 'email' && i.type === 'sent').length;
  const emails_failed = items.filter((i) => i.channel === 'email' && i.type === 'failed').length;
  const whatsapp_sent = items.filter((i) => i.channel === 'whatsapp' && i.type === 'sent').length;
  const whatsapp_failed = items.filter((i) => i.channel === 'whatsapp' && i.type === 'failed').length;

  // Count enrollments paused today
  const { count: enrollments_paused } = (await from(supabase, 'cadence_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'paused')
    .gte('updated_at', start)
    .lte('updated_at', end)
    // Filter by org via lead join
    .not('lead_id', 'is', null)) as { count: number | null };

  // Count enrollments completed today
  const { count: enrollments_completed } = (await from(supabase, 'cadence_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .gte('completed_at', start)
    .lte('completed_at', end)) as { count: number | null };

  // Count active cadences
  const { count: active_cadences } = (await from(supabase, 'cadences')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'active')) as { count: number | null };

  return {
    emails_sent,
    emails_failed,
    whatsapp_sent,
    whatsapp_failed,
    enrollments_paused: enrollments_paused ?? 0,
    enrollments_completed: enrollments_completed ?? 0,
    active_cadences: active_cadences ?? 0,
  };
}

/** Build HTML email body for the daily summary */
function buildSummaryHtml(orgName: string, metrics: DailyMetrics, dateStr: string): string {
  const totalSent = metrics.emails_sent + metrics.whatsapp_sent;
  const totalFailed = metrics.emails_failed + metrics.whatsapp_failed;
  const successRate = totalSent + totalFailed > 0
    ? Math.round((totalSent / (totalSent + totalFailed)) * 100)
    : 0;

  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <div style="padding: 24px 0; border-bottom: 2px solid #e5e7eb;">
    <h1 style="margin: 0; font-size: 20px; font-weight: 600;">Resumo diário — ${dateStr}</h1>
    <p style="margin: 4px 0 0; font-size: 14px; color: #6b7280;">${orgName}</p>
  </div>

  <div style="padding: 24px 0;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 12px 16px; background: #f0fdf4; border-radius: 8px; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: 700; color: #16a34a;">${totalSent}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Enviados</div>
        </td>
        <td style="width: 8px;"></td>
        <td style="padding: 12px 16px; background: #fef2f2; border-radius: 8px; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: 700; color: #dc2626;">${totalFailed}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Falhas</div>
        </td>
        <td style="width: 8px;"></td>
        <td style="padding: 12px 16px; background: #eff6ff; border-radius: 8px; text-align: center; width: 33%;">
          <div style="font-size: 28px; font-weight: 700; color: #2563eb;">${successRate}%</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Taxa de sucesso</div>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 16px 0; border-top: 1px solid #e5e7eb;">
    <h2 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #374151;">Detalhamento</h2>
    <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; color: #6b7280;">Emails enviados</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 500;">${metrics.emails_sent}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; color: #6b7280;">Emails com falha</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 500; ${metrics.emails_failed > 0 ? 'color: #dc2626;' : ''}">${metrics.emails_failed}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; color: #6b7280;">WhatsApp enviados</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 500;">${metrics.whatsapp_sent}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; color: #6b7280;">WhatsApp com falha</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 500; ${metrics.whatsapp_failed > 0 ? 'color: #dc2626;' : ''}">${metrics.whatsapp_failed}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; color: #6b7280;">Enrollments pausados</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 500; ${metrics.enrollments_paused > 0 ? 'color: #f59e0b;' : ''}">${metrics.enrollments_paused}</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 8px 0; color: #6b7280;">Enrollments concluídos</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 500; color: #16a34a;">${metrics.enrollments_completed}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280;">Cadências ativas</td>
        <td style="padding: 8px 0; text-align: right; font-weight: 500;">${metrics.active_cadences}</td>
      </tr>
    </table>
  </div>

  <div style="padding: 16px 0; border-top: 1px solid #e5e7eb; text-align: center;">
    <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.enriqueceai.com.br'}/cadences"
       style="display: inline-block; padding: 10px 24px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">
      Ver cadências
    </a>
  </div>

  <div style="padding: 16px 0; text-align: center;">
    <p style="margin: 0; font-size: 12px; color: #9ca3af;">
      EnriqueceAI — Resumo automático diário
    </p>
  </div>
</div>`;
}

/** Send daily cadence summary to all org managers that have Gmail connected */
export async function sendDailyCadenceSummary(): Promise<ActionResult<{ orgs_processed: number; emails_sent: number }>> {
  const supabase = createServiceRoleClient();
  const adminSupabase = createAdminSupabaseClient();

  const { start, end } = getTodayRangeBRT();
  const dateStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());

  // Fetch all organizations that have at least 1 active cadence
  const { data: orgs } = (await from(supabase, 'organizations')
    .select('id, name')) as { data: Array<{ id: string; name: string }> | null };

  if (!orgs || orgs.length === 0) {
    return { success: true, data: { orgs_processed: 0, emails_sent: 0 } };
  }

  let totalEmailsSent = 0;
  let orgsProcessed = 0;

  for (const org of orgs) {
    try {
      const metrics = await getOrgDailyMetrics(supabase, org.id, start, end);

      // Skip orgs with no activity today
      const totalActivity = metrics.emails_sent + metrics.emails_failed + metrics.whatsapp_sent + metrics.whatsapp_failed;
      if (totalActivity === 0 && metrics.enrollments_paused === 0 && metrics.enrollments_completed === 0) {
        continue;
      }

      // Fetch managers with Gmail connected
      const { data: managers } = (await from(supabase, 'organization_members')
        .select('user_id')
        .eq('org_id', org.id)
        .eq('role', 'manager')
        .eq('status', 'active')) as { data: Array<{ user_id: string }> | null };

      if (!managers || managers.length === 0) continue;

      // Get manager emails from auth.users
      const { data: users } = (await from(adminSupabase, 'users')
        .select('id, email')
        .in('id', managers.map((m) => m.user_id))) as { data: Array<{ id: string; email: string }> | null };

      if (!users || users.length === 0) continue;

      // Check which managers have Gmail connected (needed to send via their account)
      const { data: gmailConnections } = (await from(supabase, 'gmail_connections')
        .select('user_id')
        .eq('org_id', org.id)
        .eq('status', 'connected')) as { data: Array<{ user_id: string }> | null };

      const connectedUserIds = new Set((gmailConnections ?? []).map((g) => g.user_id));

      // Send summary to each manager that has Gmail connected
      const htmlBody = buildSummaryHtml(org.name, metrics, dateStr);

      for (const user of users) {
        if (!connectedUserIds.has(user.id)) continue;

        try {
          const result = await EmailService.sendEmail(
            user.id,
            org.id,
            {
              to: user.email,
              subject: `Resumo diário de cadências — ${dateStr}`,
              htmlBody,
              trackOpens: false,
              trackClicks: false,
            },
            undefined,
            supabase,
          );

          if (result.success) {
            totalEmailsSent++;
          } else {
            console.error(`[daily-summary] Failed to send summary: ${result.error}`);
          }
        } catch (err) {
          console.error('[daily-summary] Error sending summary:', err);
        }
      }

      orgsProcessed++;
    } catch (err) {
      console.error(`[daily-summary] Error processing org ${org.id}:`, err);
    }
  }

  console.warn(`[daily-summary] Complete: orgs=${orgsProcessed} emails=${totalEmailsSent}`);
  return { success: true, data: { orgs_processed: orgsProcessed, emails_sent: totalEmailsSent } };
}
