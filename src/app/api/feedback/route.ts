import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotification } from '@/features/notifications/services/notification.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RESULTS = ['meeting_done', 'no_show', 'rescheduled'];

const RESULT_LABELS: Record<string, string> = {
  meeting_done: 'Reunião realizada',
  no_show: 'Não compareceu',
  rescheduled: 'Remarcou',
};

const RATING_LABELS: Record<number, string> = {
  1: 'Muito baixa',
  2: 'Baixa',
  3: 'Regular',
  4: 'Boa',
  5: 'Excelente',
};

interface FeedbackRequestFull {
  id: string;
  org_id: string;
  lead_id: string;
  closer_id: string;
  responded_at: string | null;
  expires_at: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, result, rating, comment } = body;

    // Validate input
    if (!token || !UUID_REGEX.test(token)) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 400 });
    }
    if (!result || !VALID_RESULTS.includes(result)) {
      return NextResponse.json({ error: 'Resultado inválido' }, { status: 400 });
    }
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Nota deve ser entre 1 e 5' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Fetch feedback request with full data
    const { data: feedbackReq } = (await from(supabase, 'closer_feedback_requests')
      .select('id, org_id, lead_id, closer_id, responded_at, expires_at')
      .eq('token', token)
      .single()) as { data: FeedbackRequestFull | null };

    if (!feedbackReq) {
      return NextResponse.json({ error: 'Feedback não encontrado' }, { status: 404 });
    }

    if (feedbackReq.responded_at) {
      return NextResponse.json({ error: 'Este feedback já foi enviado' }, { status: 409 });
    }

    if (new Date(feedbackReq.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Este link expirou' }, { status: 410 });
    }

    // Save feedback
    const { error: updateError } = await from(supabase, 'closer_feedback_requests')
      .update({
        result,
        rating,
        comment: comment || null,
        responded_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', feedbackReq.id);

    if (updateError) {
      console.error('[api/feedback] Update error:', updateError);
      return NextResponse.json({ error: 'Erro ao salvar feedback' }, { status: 500 });
    }

    // Fire-and-forget: notify SDR via email
    notifySdr(supabase, feedbackReq, result, rating, comment).catch((err) =>
      console.error('[api/feedback] SDR notification error:', err),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/feedback] Unexpected error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

async function notifySdr(
  supabase: ReturnType<typeof createServiceRoleClient>,
  feedbackReq: FeedbackRequestFull,
  result: string,
  rating: number,
  comment: string | null,
) {
  // Get lead info + who marked as won (SDR)
  const { data: lead } = (await from(supabase, 'leads')
    .select('nome_fantasia, razao_social, won_by, assigned_to')
    .eq('id', feedbackReq.lead_id)
    .is('deleted_at', null)
    .single()) as { data: { nome_fantasia: string | null; razao_social: string | null; won_by: string | null; assigned_to: string | null } | null };

  if (!lead) return;

  // SDR is whoever marked as won, fallback to assigned_to
  const sdrUserId = lead.won_by ?? lead.assigned_to;
  if (!sdrUserId) return;

  // Get closer name
  const { data: closer } = (await from(supabase, 'closers')
    .select('name')
    .eq('id', feedbackReq.closer_id)
    .single()) as { data: { name: string } | null };

  const closerName = closer?.name ?? 'Closer';
  const leadName = lead.nome_fantasia ?? lead.razao_social ?? 'Lead';
  const resultLabel = RESULT_LABELS[result] ?? result;

  // Create in-app notification for the SDR (triggers Realtime)
  try {
    await createNotification({
      org_id: feedbackReq.org_id,
      user_id: sdrUserId,
      type: 'closer_feedback',
      title: `${closerName} respondeu o feedback`,
      body: `${leadName} — ${resultLabel} (${rating}/5)${comment ? `: ${comment}` : ''}`,
      resource_type: 'lead',
      resource_id: feedbackReq.lead_id,
      metadata: { closer_name: closerName, result, rating, comment },
    });
  } catch (err) {
    console.error('[api/feedback] Failed to create notification:', err);
  }
  const ratingLabel = RATING_LABELS[rating] ?? `${rating}/5`;
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);

  const htmlBody = `
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
                Feedback recebido!
              </h2>
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 24px;">
                <strong>${closerName}</strong> respondeu o feedback sobre a reunião com <strong>${leadName}</strong>.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #6b7280; font-size: 13px;">Resultado da reunião</span><br>
                    <strong style="color: #1a1a1a; font-size: 15px;">${resultLabel}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #e5e7eb;">
                    <span style="color: #6b7280; font-size: 13px;">Qualidade do lead</span><br>
                    <span style="color: #E53935; font-size: 20px; letter-spacing: 2px;">${stars}</span>
                    <span style="color: #1a1a1a; font-size: 14px; margin-left: 8px;">${ratingLabel} (${rating}/5)</span>
                  </td>
                </tr>
                ${comment ? `
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #e5e7eb;">
                    <span style="color: #6b7280; font-size: 13px;">Observações do closer</span><br>
                    <span style="color: #1a1a1a; font-size: 14px;">${comment}</span>
                  </td>
                </tr>
                ` : ''}
              </table>

              <p style="color: #9ca3af; font-size: 13px; margin: 0; line-height: 1.5;">
                Acesse a plataforma para ver mais detalhes sobre este lead.
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

  // Get SDR email from auth.users
  const { data: authData } = await supabase.auth.admin.getUserById(sdrUserId);
  const sdrEmail = authData?.user?.email;
  if (!sdrEmail) return;

  await sendPlatformEmail({
    to: sdrEmail,
    subject: `Feedback da reunião: ${leadName} — ${resultLabel}`,
    html: htmlBody,
  });
}
