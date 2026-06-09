'use server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { getAppUrl } from '@/lib/utils/app-url';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { validateBrazilianPhone } from '@/features/integrations/services/whatsapp.service';
import { getFeedbackMessengerUserId } from '@/features/leads/services/feedback-messenger.service';

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
  whatsappSkipReason?: 'no_phone' | 'invalid_phone' | 'no_manager_evolution';
}

/**
 * Creates a feedback request and notifies the closer via email (Resend) and,
 * when a phone is available, WhatsApp through the org manager's Evolution
 * instance. The manager's number — not the SDR's — is the canonical sender so
 * the closer always receives feedback prompts from the same WhatsApp identity.
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
      // Don't re-ask a closer who already graded this lead in the last 24h.
      // This happens when a lead is marked "Ganho" a second time (without a
      // reopen) hours after the first feedback was already answered, spawning a
      // duplicate request for the same meeting. A genuine second meeting is
      // always days apart (and the lead goes through a reopen first), so it
      // falls outside this window and still gets its own request.
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentlyAnswered } = (await from(supabase, 'closer_feedback_requests')
        .select('id')
        .eq('lead_id', leadId)
        .eq('closer_id', closerId)
        .not('responded_at', 'is', null)
        .gte('responded_at', since24h)
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (recentlyAnswered) {
        console.warn(
          '[closer-feedback] Skipping — closer=%s already answered feedback for lead=%s within 24h',
          closerId,
          leadId,
        );
        channels.emailError = 'already_answered_recently';
        return channels;
      }

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

    await logFeedbackInteraction(supabase, {
      orgId,
      leadId,
      senderUserId,
      channel: 'email',
      success: emailResult.success,
      closerName,
      recipient: closerEmail,
      error: emailResult.success ? undefined : channels.emailError,
    });

    // WhatsApp via Evolution. The message goes out from the org manager's
    // instance, not the SDR who closed the lead — closers should see a single
    // canonical sender regardless of who marked the meeting as won. If no
    // manager has an Evolution instance connected, skip silently: the email
    // already serves as the primary, durable channel.
    if (!closerPhone) {
      channels.whatsappSkipReason = 'no_phone';
    } else if (!validateBrazilianPhone(closerPhone)) {
      channels.whatsappSkipReason = 'invalid_phone';
      console.warn('[closer-feedback] Skipping WhatsApp — invalid phone:', closerPhone);
    } else {
      const messengerUserId = await getFeedbackMessengerUserId(supabase, orgId);
      if (!messengerUserId) {
        channels.whatsappSkipReason = 'no_manager_evolution';
        console.warn('[closer-feedback] Skipping WhatsApp — no manager with connected Evolution for org=%s', orgId);
      } else {
        const wppBody = buildFeedbackWhatsAppBody(closerName, leadName, feedbackUrl);
        const wppResult = await EvolutionWhatsAppService.sendMessage(
          orgId,
          { to: closerPhone, body: wppBody },
          supabase,
          messengerUserId,
        );
        if (wppResult.success) {
          channels.whatsapp = 'sent';
        } else {
          channels.whatsapp = 'failed';
          channels.whatsappError = wppResult.error ?? 'unknown_whatsapp_error';
          console.error('[closer-feedback] WhatsApp delivery failed:', wppResult.error);
        }

        await logFeedbackInteraction(supabase, {
          orgId,
          leadId,
          senderUserId,
          channel: 'whatsapp',
          success: wppResult.success,
          closerName,
          recipient: closerPhone,
          messageId: wppResult.messageId,
          error: wppResult.success ? undefined : channels.whatsappError,
        });
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

/**
 * Persist a row in `interactions` per channel attempt so the lead timeline
 * shows whether the closer feedback request actually went out (and via which
 * number/email). Without this the WhatsApp leg was fire-and-forget and the
 * only way to confirm delivery was looking at the SDR's phone — meaning
 * disconnected Evolution instances (e.g. Matheus on 2026-05-14) silently
 * dropped feedback notifications with no signal in the platform.
 */
async function logFeedbackInteraction(
  supabase: ReturnType<typeof createServiceRoleClient>,
  params: {
    orgId: string;
    leadId: string;
    senderUserId: string;
    channel: 'email' | 'whatsapp';
    success: boolean;
    closerName: string;
    recipient: string;
    messageId?: string;
    error?: string;
  },
): Promise<void> {
  try {
    const verb = params.channel === 'email' ? 'Email' : 'WhatsApp';
    const status = params.success ? 'enviado' : 'falhou';
    const message = `${verb} de solicitação de feedback ${status} para ${params.closerName}`;
    await from(supabase, 'interactions').insert({
      org_id: params.orgId,
      lead_id: params.leadId,
      type: params.success ? 'sent' : 'failed',
      channel: params.channel,
      message_content: message,
      performed_by: params.senderUserId,
      metadata: {
        source: 'closer_feedback',
        recipient_kind: 'closer',
        recipient: params.recipient,
        message_id: params.messageId ?? null,
        error: params.error ?? null,
      },
    } as Record<string, unknown>);
  } catch (err) {
    console.error('[closer-feedback] Failed to log interaction:', err);
  }
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
