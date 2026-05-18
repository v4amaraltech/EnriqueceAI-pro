import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getAppUrl } from '@/lib/utils/app-url';

export const maxDuration = 30;

/**
 * Manual one-shot resend of a closer_feedback_request email. Idempotent —
 * does NOT advance reminder_count or trigger manager escalation. The body
 * mirrors the *original* feedback request email so the closer receives the
 * same call-to-action they got the first time, not an escalation.
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { feedbackRequestIds?: string[] };
  const ids = body.feedbackRequestIds ?? [];
  if (!ids.length) {
    return NextResponse.json({ error: 'feedbackRequestIds required (array)' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const appUrl = getAppUrl();

  const { data: requests } = (await from(supabase, 'closer_feedback_requests')
    .select('id, token, lead_id, closer_id, responded_at, expires_at')
    .in('id', ids)) as {
    data: Array<{
      id: string;
      token: string;
      lead_id: string;
      closer_id: string;
      responded_at: string | null;
      expires_at: string;
    }> | null;
  };

  if (!requests?.length) {
    return NextResponse.json({ error: 'no requests found' }, { status: 404 });
  }

  const closerIds = [...new Set(requests.map((r) => r.closer_id))];
  const leadIds = [...new Set(requests.map((r) => r.lead_id))];

  const [closersResult, leadsResult] = await Promise.all([
    from(supabase, 'closers').select('id, name, email').in('id', closerIds) as Promise<{
      data: Array<{ id: string; name: string; email: string }> | null;
    }>,
    from(supabase, 'leads').select('id, nome_fantasia, razao_social').in('id', leadIds).is('deleted_at', null) as Promise<{
      data: Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }> | null;
    }>,
  ]);

  const closerMap = new Map((closersResult.data ?? []).map((c) => [c.id, c]));
  const leadMap = new Map(
    (leadsResult.data ?? []).map((l) => [l.id, l.nome_fantasia ?? l.razao_social ?? 'Lead']),
  );

  const results: Array<{ id: string; status: 'sent' | 'skipped' | 'error'; reason?: string }> = [];

  for (const req of requests) {
    if (req.responded_at) {
      results.push({ id: req.id, status: 'skipped', reason: 'already_responded' });
      continue;
    }
    if (new Date(req.expires_at) < new Date()) {
      results.push({ id: req.id, status: 'skipped', reason: 'expired' });
      continue;
    }

    const closer = closerMap.get(req.closer_id);
    if (!closer) {
      results.push({ id: req.id, status: 'error', reason: 'closer_not_found' });
      continue;
    }

    const leadName = leadMap.get(req.lead_id) ?? 'Lead';
    const feedbackUrl = `${appUrl}/feedback/${req.token}`;
    const html = buildFeedbackEmailHtml(closer.name, leadName, feedbackUrl, appUrl);

    const result = await sendPlatformEmail({
      to: closer.email,
      subject: `Feedback da reunião: ${leadName}`,
      html,
    });

    if (result.success) {
      results.push({ id: req.id, status: 'sent' });
    } else {
      results.push({ id: req.id, status: 'error', reason: result.error ?? 'unknown' });
    }
  }

  return NextResponse.json({ results });
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
