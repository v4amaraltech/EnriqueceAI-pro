'use server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { sendPlatformEmail } from '@/lib/email/platform-email';

interface SendFeedbackParams {
  leadId: string;
  orgId: string;
  closerId: string;
  closerName: string;
  closerEmail: string;
  leadName: string;
  senderUserId: string;
}

/**
 * Creates a feedback request and sends email to the closer via platform email (Resend).
 * Called fire-and-forget after markLeadAsWon — errors are logged but don't block the flow.
 */
export async function sendCloserFeedbackEmail(params: SendFeedbackParams): Promise<void> {
  const { leadId, orgId, closerId, closerName, closerEmail, leadName } = params;
  const supabase = createServiceRoleClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  try {
    // Create feedback request record
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
      return;
    }

    const feedbackUrl = `${appUrl}/feedback/${request.token}`;
    const html = buildFeedbackEmailHtml(closerName, leadName, feedbackUrl);

    // Send via platform email (Resend) — no Gmail dependency
    const result = await sendPlatformEmail({
      to: closerEmail,
      subject: `Feedback da reunião: ${leadName}`,
      html,
    });

    if (!result.success) {
      console.error('[closer-feedback] Failed to send email:', result.error);
    }
  } catch (err) {
    console.error('[closer-feedback] Unexpected error:', err);
  }
}

function buildFeedbackEmailHtml(closerName: string, leadName: string, feedbackUrl: string): string {
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
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">EnriqueceAI</h1>
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
