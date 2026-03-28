import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 60;

interface PendingFeedback {
  id: string;
  token: string;
  sent_at: string;
  lead_id: string;
  closer_id: string;
  org_id: string;
}

interface CloserInfo {
  id: string;
  name: string;
  email: string;
}

interface LeadInfo {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
}

/**
 * Cron: Send reminder emails to closers who haven't responded to feedback after 3 days.
 * Runs daily. Only sends one reminder per feedback request (tracked via reminder_sent_at).
 */
async function sendFeedbackReminders() {
  const supabase = createServiceRoleClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // Find feedbacks sent > 3 days ago, not responded, not expired, no reminder sent yet
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: pending, error } = (await from(supabase, 'closer_feedback_requests')
    .select('id, token, sent_at, lead_id, closer_id, org_id')
    .is('responded_at', null)
    .is('reminder_sent_at', null)
    .lt('sent_at', threeDaysAgo)
    .gt('expires_at', new Date().toISOString())
    .limit(50)) as { data: PendingFeedback[] | null; error: unknown };

  if (error || !pending?.length) {
    return { reminders: 0, errors: 0 };
  }

  // Batch fetch closer and lead info
  const closerIds = [...new Set(pending.map((p) => p.closer_id))];
  const leadIds = [...new Set(pending.map((p) => p.lead_id))];

  const [closersResult, leadsResult] = await Promise.all([
    from(supabase, 'closers').select('id, name, email').in('id', closerIds) as Promise<{ data: CloserInfo[] | null }>,
    from(supabase, 'leads').select('id, nome_fantasia, razao_social').in('id', leadIds) as Promise<{ data: LeadInfo[] | null }>,
  ]);

  const closerMap = new Map((closersResult.data ?? []).map((c) => [c.id, c]));
  const leadMap = new Map((leadsResult.data ?? []).map((l) => [l.id, l.nome_fantasia ?? l.razao_social ?? 'Lead']));

  let sent = 0;
  let errors = 0;

  for (const fb of pending) {
    const closer = closerMap.get(fb.closer_id);
    if (!closer) continue;

    const leadName = leadMap.get(fb.lead_id) ?? 'Lead';
    const feedbackUrl = `${appUrl}/feedback/${fb.token}`;

    const html = buildReminderHtml(closer.name, leadName, feedbackUrl);

    const result = await sendPlatformEmail({
      to: closer.email,
      subject: `Lembrete: Feedback da reunião com ${leadName}`,
      html,
    });

    if (result.success) {
      // Mark reminder as sent
      await from(supabase, 'closer_feedback_requests')
        .update({ reminder_sent_at: new Date().toISOString() } as Record<string, unknown>)
        .eq('id', fb.id);
      sent++;
    } else {
      console.error('[feedback-reminders] Failed to send to', closer.email, result.error);
      errors++;
    }
  }

  return { reminders: sent, errors };
}

function buildReminderHtml(closerName: string, leadName: string, feedbackUrl: string): string {
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
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">EnriqueceAI</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px; font-size: 18px; color: #1a1a1a;">
                Lembrete de feedback
              </h2>
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 16px;">
                Olá, <strong>${closerName}</strong>!
              </p>
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 24px;">
                Ainda não recebemos seu feedback sobre a reunião com <strong>${leadName}</strong>. Sua avaliação é importante para melhorarmos a qualidade dos leads.
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
