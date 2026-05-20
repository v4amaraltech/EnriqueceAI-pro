'use server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { getAppUrl } from '@/lib/utils/app-url';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { validateBrazilianPhone } from '@/features/integrations/services/whatsapp.service';

interface SendFeedbackParams {
  leadId: string;
  orgId: string;
  closerId: string;
  closerName: string;
  closerEmail: string;
  closerPhone: string | null;
  leadName: string;
  senderUserId: string;
}

export interface SendFeedbackChannelResult {
  email: 'sent' | 'failed';
  whatsapp: 'sent' | 'skipped' | 'failed';
  emailError?: string;
  whatsappError?: string;
  whatsappSkipReason?: 'no_phone' | 'invalid_phone';
}

/**
 * Creates a feedback request and notifies the closer via email (Resend) and,
 * when a phone is available, WhatsApp through the sender's Evolution instance.
 * Called fire-and-forget from markLeadAsWon and synchronously by the
 * `resendCloserFeedback` action.
 */
export async function sendCloserFeedbackEmail(params: SendFeedbackParams): Promise<SendFeedbackChannelResult> {
  const { leadId, orgId, closerId, closerName, closerEmail, closerPhone, leadName, senderUserId } = params;
  const supabase = createServiceRoleClient();
  const appUrl = getAppUrl();
  const channels: SendFeedbackChannelResult = { email: 'failed', whatsapp: 'skipped' };

  try {
    // Check if a pending feedback request already exists (e.g. created by meeting briefing)
    const { data: existing } = (await from(supabase, 'closer_feedback_requests')
      .select('id, token')
      .eq('lead_id', leadId)
      .eq('closer_id', closerId)
      .is('responded_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string; token: string } | null };

    let feedbackToken: string;

    if (existing) {
      // Reuse existing pending feedback request — don't create duplicate
      feedbackToken = existing.token;
      console.warn('[closer-feedback] Reusing existing feedback request for lead=%s', leadId);
    } else {
      // Don't create a feedback request before the meeting actually happens.
      // Otherwise the closer gets pestered to grade a meeting that's still in the future.
      const { data: latestMeeting } = (await from(supabase, 'interactions')
        .select('metadata')
        .eq('lead_id', leadId)
        .eq('type', 'meeting_scheduled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()) as { data: { metadata: Record<string, unknown> | null } | null };

      const startTimeRaw = latestMeeting?.metadata?.start_time as string | undefined;
      if (startTimeRaw) {
        const startTime = new Date(startTimeRaw);
        if (startTime.getTime() > Date.now()) {
          console.warn(
            '[closer-feedback] Skipping feedback creation — meeting still in future. lead=%s start=%s',
            leadId,
            startTimeRaw,
          );
          channels.emailError = 'meeting_in_future';
          return channels;
        }
      }

      // Create new feedback request
      const { data: request, error: insertError } = (await from(supabase, 'closer_feedback_requests')
        .insert({
          org_id: orgId,
          lead_id: leadId,
          closer_id: closerId,
        })
        .select('id, token')
        .single()) as { data: { id: string; token: string } | null; error: { message: string } | null };

      if (insertError || !request) {
        console.error('[closer-feedback] Failed to create feedback request:', insertError?.message);
        channels.emailError = insertError?.message ?? 'feedback_request_insert_failed';
        return channels;
      }
      feedbackToken = request.token;
    }

    const feedbackUrl = `${appUrl}/feedback/${feedbackToken}`;
    const html = buildFeedbackEmailHtml(closerName, leadName, feedbackUrl, appUrl);

    // Send via platform email (Resend) — no Gmail dependency
    const emailResult = await sendPlatformEmail({
      to: closerEmail,
      subject: `Feedback da reunião: ${leadName}`,
      html,
    });

    if (emailResult.success) {
      channels.email = 'sent';
    } else {
      channels.emailError = emailResult.error ?? 'unknown_email_error';
      console.error('[closer-feedback] Failed to send email:', emailResult.error);
    }

    // WhatsApp via Evolution using the sender's per-user instance. Fire after
    // the email so the closer always has the canonical record in their inbox
    // even if WhatsApp delivery is delayed or the instance is offline.
    if (!closerPhone) {
      channels.whatsappSkipReason = 'no_phone';
    } else if (!validateBrazilianPhone(closerPhone)) {
      channels.whatsappSkipReason = 'invalid_phone';
      console.warn('[closer-feedback] Skipping WhatsApp — invalid phone:', closerPhone);
    } else {
      const wppBody = buildFeedbackWhatsAppBody(closerName, leadName, feedbackUrl);
      const wppResult = await EvolutionWhatsAppService.sendMessage(
        orgId,
        { to: closerPhone, body: wppBody },
        supabase,
        senderUserId,
      );
      if (wppResult.success) {
        channels.whatsapp = 'sent';
      } else {
        channels.whatsapp = 'failed';
        channels.whatsappError = wppResult.error ?? 'unknown_whatsapp_error';
        console.error('[closer-feedback] WhatsApp delivery failed:', wppResult.error);
      }
    }
  } catch (err) {
    console.error('[closer-feedback] Unexpected error:', err);
    if (channels.email !== 'sent' && !channels.emailError) {
      channels.emailError = err instanceof Error ? err.message : String(err);
    }
  }
  return channels;
}

function buildFeedbackWhatsAppBody(closerName: string, leadName: string, feedbackUrl: string): string {
  return `Olá ${closerName}! 👋\n\nUma reunião com *${leadName}* foi marcada como ganha pelo pré-vendas.\n\nPodemos contar com seu feedback sobre a reunião?\n\n📋 Responder: ${feedbackUrl}\n\n_Leva menos de 1 minuto._`;
}

function buildFeedbackEmailHtml(closerName: string, leadName: string, feedbackUrl: string, appUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
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
                Olá, ${closerName}!
              </h2>
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 16px;">
                Uma reunião com o lead <strong>${leadName}</strong> foi marcada como ganha pelo pré-vendas.
              </p>
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 24px;">
                Gostaríamos de saber como foi a reunião. Por favor, clique no botão abaixo para enviar seu feedback:
              </p>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${feedbackUrl}" style="display: inline-block; background: #E53935; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                      Enviar Feedback
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0; line-height: 1.5;">
                Este link expira em 7 dias. Se você não participou desta reunião, pode ignorar este email.
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
