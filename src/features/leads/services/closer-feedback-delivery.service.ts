import { from } from '@/lib/supabase/from';
import type { createServiceRoleClient } from '@/lib/supabase/service';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { getAppUrl } from '@/lib/utils/app-url';
import { parseBrtDateTime } from '@/lib/utils/brt-date';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';
import { validateBrazilianPhone } from '@/features/integrations/services/whatsapp.service';
import { getFeedbackMessengerUserId } from '@/features/leads/services/feedback-messenger.service';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** Validade do link a partir do envio real (mesmo prazo histórico de 7 dias). */
export const FEEDBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SendFeedbackChannelResult {
  /** `scheduled` = reunião ainda não começou; o cron envia quando ela passar. */
  email: 'sent' | 'failed' | 'scheduled';
  whatsapp: 'sent' | 'skipped' | 'failed';
  emailError?: string;
  whatsappError?: string;
  whatsappSkipReason?: 'no_phone' | 'invalid_phone' | 'no_manager_evolution';
  /** ISO do início da reunião quando o envio foi adiado. */
  scheduledFor?: string;
}

export interface DeliverFeedbackParams {
  requestId: string;
  token: string;
  orgId: string;
  leadId: string;
  closerName: string;
  closerEmail: string;
  closerPhone: string | null;
  leadName: string;
  /** Quem aparece como autor na timeline (SDR do Ganho, ou o dono do lead no cron). */
  performedBy: string | null;
  /**
   * true quando a linha ainda está com `sent_at IS NULL`: ao sair por pelo
   * menos um canal, carimba `sent_at = now()` e reinicia `expires_at` para
   * contar os 7 dias do envio real. false = reenvio de link já entregue.
   */
  stampSentAt: boolean;
}

/**
 * Início da reunião atual do lead. Fonte canônica: leads.meeting_starts_at
 * (timestamptz). Fallback legado: metadata.start_time da interação
 * meeting_scheduled mais recente — hora de PAREDE em BRT, ancorada com
 * parseBrtDateTime (new Date() direto lia 3h errado num servidor UTC).
 */
export async function resolveMeetingStart(supabase: ServiceClient, leadId: string): Promise<Date | null> {
  const { data: leadRow } = (await from(supabase, 'leads')
    .select('meeting_starts_at')
    .eq('id', leadId)
    .maybeSingle()) as { data: { meeting_starts_at: string | null } | null };

  let meetingStart: Date | null = leadRow?.meeting_starts_at ? new Date(leadRow.meeting_starts_at) : null;
  if (meetingStart && !Number.isNaN(meetingStart.getTime())) return meetingStart;

  const { data: latestMeeting } = (await from(supabase, 'interactions')
    .select('metadata')
    .eq('lead_id', leadId)
    .eq('type', 'meeting_scheduled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { metadata: Record<string, unknown> | null } | null };
  const startTimeRaw = latestMeeting?.metadata?.start_time as string | undefined;
  meetingStart = startTimeRaw ? parseBrtDateTime(startTimeRaw) : null;
  return meetingStart && !Number.isNaN(meetingStart.getTime()) ? meetingStart : null;
}

/**
 * Entrega o link de feedback ao closer: e-mail via Resend e, quando há
 * telefone, WhatsApp pela instância Evolution do gestor da org (remetente
 * canônico — o closer sempre vê o mesmo número, não o do SDR). Cada canal
 * grava uma interação na timeline do lead. Usado pelo Ganho / reenvio manual
 * (sendCloserFeedbackEmail) e pelo cron feedback-reminders (envio adiado).
 */
export async function deliverCloserFeedbackRequest(
  supabase: ServiceClient,
  params: DeliverFeedbackParams,
): Promise<SendFeedbackChannelResult> {
  const { requestId, token, orgId, leadId, closerName, closerEmail, closerPhone, leadName, performedBy, stampSentAt } = params;
  const appUrl = getAppUrl();
  const channels: SendFeedbackChannelResult = { email: 'failed', whatsapp: 'skipped' };
  const feedbackUrl = `${appUrl}/feedback/${token}`;

  const emailResult = await sendPlatformEmail({
    to: closerEmail,
    subject: `Feedback da reunião: ${leadName}`,
    html: buildFeedbackEmailHtml(closerName, leadName, feedbackUrl, appUrl),
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
    performedBy,
    channel: 'email',
    success: emailResult.success,
    closerName,
    recipient: closerEmail,
    error: emailResult.success ? undefined : channels.emailError,
  });

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
      const wppResult = await EvolutionWhatsAppService.sendMessage(
        orgId,
        { to: closerPhone, body: buildFeedbackWhatsAppBody(closerName, leadName, feedbackUrl) },
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
        performedBy,
        channel: 'whatsapp',
        success: wppResult.success,
        closerName,
        recipient: closerPhone,
        messageId: wppResult.messageId,
        error: wppResult.success ? undefined : channels.whatsappError,
      });
    }
  }

  // Só conta como enviado quando pelo menos um canal saiu. Se os dois falharam
  // a linha fica com sent_at NULL e o cron tenta de novo (até expires_at).
  if (stampSentAt && (channels.email === 'sent' || channels.whatsapp === 'sent')) {
    const now = Date.now();
    const { error: stampError } = (await from(supabase, 'closer_feedback_requests')
      .update({
        sent_at: new Date(now).toISOString(),
        expires_at: new Date(now + FEEDBACK_TTL_MS).toISOString(),
        reminder_count: 0,
        reminder_sent_at: null,
      } as Record<string, unknown>)
      .eq('id', requestId)
      .is('sent_at', null)) as { error: { message: string } | null };
    if (stampError) {
      console.error('[closer-feedback] Failed to stamp sent_at for request=%s:', requestId, stampError.message);
    }
  }

  return channels;
}

/**
 * Timeline: "feedback agendado". Registrado uma vez, quando o pedido nasce (ou
 * é reativado) com a reunião ainda no futuro — assim o SDR/gestor vê que o
 * link vai sair sozinho depois da reunião, em vez de um silêncio.
 */
export async function logFeedbackScheduledInteraction(
  supabase: ServiceClient,
  params: { orgId: string; leadId: string; performedBy: string | null; closerName: string; meetingStart: Date },
): Promise<void> {
  try {
    await from(supabase, 'interactions').insert({
      org_id: params.orgId,
      lead_id: params.leadId,
      channel: 'system',
      type: 'sent',
      message_content: `Feedback de ${params.closerName} agendado para depois da reunião (${formatBrt(params.meetingStart)})`,
      performed_by: params.performedBy,
      metadata: {
        source: 'closer_feedback',
        system_event: 'closer_feedback_scheduled',
        scheduled_for: params.meetingStart.toISOString(),
      },
    } as Record<string, unknown>);
  } catch (err) {
    console.error('[closer-feedback] Failed to log scheduled interaction:', err);
  }
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
  supabase: ServiceClient,
  params: {
    orgId: string;
    leadId: string;
    performedBy: string | null;
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
      performed_by: params.performedBy,
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

function formatBrt(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
