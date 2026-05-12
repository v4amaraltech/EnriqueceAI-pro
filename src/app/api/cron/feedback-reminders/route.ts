import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getAppUrl } from '@/lib/utils/app-url';

import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';
import { WhatsAppService, validateBrazilianPhone } from '@/features/integrations/services/whatsapp.service';

export const maxDuration = 60;

const REMINDER_INTERVAL_HOURS = 24;
const MAX_REMINDERS = 3;
const ESCALATE_AFTER_REMINDERS = 2;

interface PendingFeedback {
  id: string;
  token: string;
  sent_at: string;
  lead_id: string;
  closer_id: string;
  org_id: string;
  reminder_count: number;
  reminder_sent_at: string | null;
}

interface CloserInfo {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

interface LeadInfo {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
}

interface MeetingTiming {
  lead_id: string;
  start_time: string;
}

/**
 * Cron: Send reminders to closers who haven't responded to feedback.
 *
 * Eligibility (per request):
 *  - responded_at IS NULL (still pending)
 *  - expires_at > now() (not expired)
 *  - reminder_count < MAX_REMINDERS (cap on cobrança)
 *  - Either: never reminded AND meeting start_time + 24h <= now (gives closer 24h grace after meeting)
 *  - Or: reminder_sent_at + 24h <= now (next reminder is 24h after the previous)
 *
 * Side effects per delivery:
 *  - Email via Resend + WhatsApp via Evolution
 *  - reminder_count++ and reminder_sent_at = now()
 *  - When new reminder_count >= 2, notify managers
 */
async function sendFeedbackReminders() {
  const supabase = createServiceRoleClient();
  const appUrl = getAppUrl();
  const now = new Date();
  const intervalAgo = new Date(now.getTime() - REMINDER_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();

  // Pull all candidates: pending, not expired, under reminder cap
  const { data: candidates, error } = (await from(supabase, 'closer_feedback_requests')
    .select('id, token, sent_at, lead_id, closer_id, org_id, reminder_count, reminder_sent_at')
    .is('responded_at', null)
    .lt('reminder_count', MAX_REMINDERS)
    .gt('expires_at', now.toISOString())
    .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${intervalAgo}`)
    .limit(200)) as { data: PendingFeedback[] | null; error: unknown };

  if (error || !candidates?.length) {
    return { reminders: 0, errors: 0, skipped: 0 };
  }

  // Pull meeting start_time for each lead — first try the meeting_scheduled
  // interaction's metadata; for leads that lack that interaction (or have it
  // without start_time), fall back to leads.meeting_scheduled_at. Audit on
  // 2026-05-12 showed 62% of Q4-latency feedbacks (closers responding >5d
  // late) had no start_time in the interaction, so the cron silently skipped
  // every reminder for them.
  const leadIds = [...new Set(candidates.map((c) => c.lead_id))];
  const { data: meetingsRaw } = (await from(supabase, 'interactions')
    .select('lead_id, metadata, created_at')
    .eq('type', 'meeting_scheduled')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false })) as {
    data: Array<{ lead_id: string; metadata: Record<string, unknown> | null }> | null;
  };

  const meetingMap = new Map<string, MeetingTiming>();
  for (const m of meetingsRaw ?? []) {
    if (meetingMap.has(m.lead_id)) continue; // first row per lead is latest
    const startTime = (m.metadata?.start_time as string | undefined) ?? null;
    if (startTime) {
      meetingMap.set(m.lead_id, { lead_id: m.lead_id, start_time: startTime });
    }
  }

  // Fallback for leads still without a start_time: read leads.meeting_scheduled_at.
  const leadsMissingMeeting = leadIds.filter((id) => !meetingMap.has(id));
  if (leadsMissingMeeting.length > 0) {
    const { data: leadsRaw } = (await from(supabase, 'leads')
      .select('id, meeting_scheduled_at')
      .in('id', leadsMissingMeeting)) as {
      data: Array<{ id: string; meeting_scheduled_at: string | null }> | null;
    };
    for (const l of leadsRaw ?? []) {
      if (l.meeting_scheduled_at) {
        meetingMap.set(l.id, { lead_id: l.id, start_time: l.meeting_scheduled_at });
      }
    }
  }

  // Filter to truly eligible: meeting + 24h must have passed (only checked on first reminder)
  const eligible = candidates.filter((fb) => {
    if (fb.reminder_sent_at) {
      // Subsequent reminders are gated only by the 24h interval already in the SQL filter
      return true;
    }
    const meeting = meetingMap.get(fb.lead_id);
    if (!meeting) return false; // No meeting found — don't pester
    const meetingPlus24h = new Date(new Date(meeting.start_time).getTime() + REMINDER_INTERVAL_HOURS * 60 * 60 * 1000);
    return meetingPlus24h <= now;
  });

  if (!eligible.length) {
    return { reminders: 0, errors: 0, skipped: candidates.length };
  }

  // Batch fetch closer + lead info
  const closerIds = [...new Set(eligible.map((e) => e.closer_id))];
  const eligibleLeadIds = [...new Set(eligible.map((e) => e.lead_id))];

  const [closersResult, leadsResult] = await Promise.all([
    from(supabase, 'closers').select('id, name, email, phone').in('id', closerIds) as Promise<{ data: CloserInfo[] | null }>,
    from(supabase, 'leads').select('id, nome_fantasia, razao_social').in('id', eligibleLeadIds).is('deleted_at', null) as Promise<{ data: LeadInfo[] | null }>,
  ]);

  const closerMap = new Map((closersResult.data ?? []).map((c) => [c.id, c]));
  const leadMap = new Map((leadsResult.data ?? []).map((l) => [l.id, l.nome_fantasia ?? l.razao_social ?? 'Lead']));

  let sent = 0;
  let errors = 0;

  for (const fb of eligible) {
    const closer = closerMap.get(fb.closer_id);
    if (!closer) continue;

    const leadName = leadMap.get(fb.lead_id) ?? 'Lead';
    const feedbackUrl = `${appUrl}/feedback/${fb.token}`;
    const newCount = fb.reminder_count + 1;

    const html = buildReminderHtml(closer.name, leadName, feedbackUrl, appUrl, newCount);

    const result = await sendPlatformEmail({
      to: closer.email,
      subject: newCount === 1
        ? `Lembrete: Feedback da reunião com ${leadName}`
        : `[${newCount}ª cobrança] Feedback pendente: ${leadName}`,
      html,
    });

    if (result.success) {
      // Claim atomically: only the run that successfully transitions
      // reminder_count from N to N+1 owns this reminder. Without this guard,
      // two concurrent ticks (Vercel retries / overlapping cron) both bumped
      // the counter and both fired manager escalation, leaving 5 duplicate
      // "Closer X não respondeu" notifications for the same recipient.
      const { data: claimed } = (await from(supabase, 'closer_feedback_requests')
        .update({
          reminder_sent_at: new Date().toISOString(),
          reminder_count: newCount,
        } as Record<string, unknown>)
        .eq('id', fb.id)
        .eq('reminder_count', fb.reminder_count)
        .select('id')) as { data: Array<{ id: string }> | null };

      if (!claimed?.length) {
        // Someone else already advanced this reminder — skip the side effects.
        continue;
      }

      // WhatsApp parallel channel
      if (closer.phone && validateBrazilianPhone(closer.phone)) {
        WhatsAppService.sendMessage(fb.org_id, {
          to: closer.phone,
          body: buildWhatsAppBody(closer.name, leadName, feedbackUrl, newCount),
        }, supabase).catch((err) => console.error('[feedback-reminders] WhatsApp error:', err));
      }

      // Manager escalation: trigger when reminder count crosses the escalation threshold
      if (newCount >= ESCALATE_AFTER_REMINDERS) {
        createNotificationsForOrgMembers({
          orgId: fb.org_id,
          type: 'closer_feedback',
          title: `Closer ${closer.name} ignorou ${newCount} lembretes`,
          body: `Feedback da reunião com ${leadName} segue pendente após ${newCount} cobranças. Por favor verifique.`,
          resourceType: 'lead',
          resourceId: fb.lead_id,
          roleFilter: 'manager',
        }).catch((err) => console.error('[feedback-reminders] notification error:', err));
      }

      sent++;
    } else {
      console.error('[feedback-reminders] Failed to send to', closer.email, result.error);
      errors++;
    }
  }

  return { reminders: sent, errors, skipped: candidates.length - eligible.length };
}

function buildWhatsAppBody(closerName: string, leadName: string, feedbackUrl: string, count: number): string {
  if (count === 1) {
    return `Olá ${closerName}! 👋\n\nAinda não recebemos seu feedback sobre a reunião com *${leadName}*.\n\nSua avaliação é muito importante para melhorarmos a qualidade dos leads.\n\n📋 Responda aqui: ${feedbackUrl}\n\n_Leva menos de 1 minuto!_`;
  }
  if (count === 2) {
    return `Oi ${closerName}, *segunda cobrança* do feedback da reunião com *${leadName}*.\n\nO seu retorno é o que mantém a qualidade do funil. Por favor responda em ${feedbackUrl}\n\n_Leva 1 minuto._`;
  }
  return `${closerName}, *terceira e última cobrança* do feedback de *${leadName}*.\n\nSe você não responder, vamos escalar a pendência ao gestor. Link: ${feedbackUrl}`;
}

function buildReminderHtml(closerName: string, leadName: string, feedbackUrl: string, appUrl: string, count: number): string {
  const heading = count === 1
    ? 'Lembrete de feedback'
    : count === 2
      ? '⚠️ Feedback ainda pendente — 2ª cobrança'
      : '🚨 Última cobrança antes de escalar';

  const tone = count === 1
    ? `Ainda não recebemos seu feedback sobre a reunião com <strong>${leadName}</strong>. Sua avaliação é importante para melhorarmos a qualidade dos leads.`
    : count === 2
      ? `Esta é a segunda cobrança sobre o feedback da reunião com <strong>${leadName}</strong>. O retorno é essencial para a operação.`
      : `Esta é a terceira e última cobrança sobre o feedback de <strong>${leadName}</strong>. Se não responder, a pendência será escalada ao gestor.`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: #1a1a1a; padding: 24px 32px;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="vertical-align: middle; padding-right: 12px;"><img src="${appUrl}/logos/logo-ea-red.png" alt="EnriqueceAI" width="36" height="36" style="border-radius: 8px;" /></td>
                <td style="vertical-align: middle;"><h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">EnriqueceAI</h1></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 18px; color: #1a1a1a;">
                ${heading}
              </h2>
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 16px;">
                Olá, <strong>${closerName}</strong>!
              </p>
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 24px;">
                ${tone}
              </p>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${feedbackUrl}" style="display: inline-block; background: #E53935; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                      Enviar Feedback Agora
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0; line-height: 1.5;">
                Este link expira em breve. Se você já respondeu ou não participou desta reunião, pode ignorar este email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background: #f9fafb; padding: 16px 32px; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Enviado automaticamente pelo EnriqueceAI
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendFeedbackReminders();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[feedback-reminders] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
