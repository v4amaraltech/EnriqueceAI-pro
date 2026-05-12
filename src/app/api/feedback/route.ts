import { NextResponse, after } from 'next/server';

import { from } from '@/lib/supabase/from';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotification, createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';
import { pushLeadToCrmWithDefaults } from '@/features/leads/services/crm-push.service';

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
    // Rating is required only for meeting_done
    const needsRating = result === 'meeting_done';
    if (needsRating && (!rating || typeof rating !== 'number' || rating < 1 || rating > 5)) {
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

    // Save feedback — conditional update prevents race condition (two concurrent submits)
    const { data: updated, error: updateError } = await from(supabase, 'closer_feedback_requests')
      .update({
        result,
        rating: rating ?? null,
        comment: comment || null,
        responded_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', feedbackReq.id)
      .is('responded_at', null)
      .select('id') as { data: Array<{ id: string }> | null; error: { message: string } | null };

    if (updateError) {
      console.error('[api/feedback] Update error:', updateError);
      return NextResponse.json({ error: 'Erro ao salvar feedback' }, { status: 500 });
    }

    if (!updated?.length) {
      return NextResponse.json({ error: 'Este feedback já foi enviado' }, { status: 409 });
    }

    // Stamp meeting_held_at when closer confirms the meeting actually happened.
    // This tracks SAL quality (held-rate, closer rejection rate) but does NOT
    // change lead status — the lead is already 'won' from markLeadAsWon (SDR's
    // click). Feedback is a parallel quality signal, not a status gate.
    //
    // CRM push is also no longer needed here: markLeadAsWon already pushed
    // when the SDR clicked Ganho. Keeping a defensive pushLeadToCrmWithDefaults
    // covers the edge case where the SDR never clicked Ganho but the closer
    // somehow received and answered the feedback link (legacy data).
    if (result === 'meeting_done') {
      const heldAt = new Date().toISOString();
      await from(supabase, 'leads')
        .update({ meeting_held_at: heldAt } as Record<string, unknown>)
        .eq('id', feedbackReq.lead_id)
        .eq('org_id', feedbackReq.org_id)
        .is('meeting_held_at', null);

      // Defensive CRM push — covers legacy leads that never went through
      // markLeadAsWon. pushLeadToCrmWithDefaults is idempotent (dedupes on
      // crm_deal_created), so it's a no-op for leads already synced.
      after(() =>
        pushLeadToCrmWithDefaults(feedbackReq.org_id, feedbackReq.lead_id)
          .then((res) => {
            if (!res.dealCreated && res.skippedReason && res.skippedReason !== 'already_synced') {
              console.warn('[api/feedback] CRM push skipped:', res.skippedReason, 'lead=', feedbackReq.lead_id);
            }
          })
          .catch((err) => console.error('[api/feedback] CRM push error:', err)),
      );
    } else if (result === 'no_show' || result === 'rescheduled') {
      // Closer signaled the meeting didn't happen — reopen the lead.
      // SDR's "Ganho" click had marked it 'won', but closer's reality wins:
      // status reverts to 'qualified' so SDR sees Ganho/Perdido buttons again
      // and the lead leaves the "won" metric. Keeps closer_id, qualified_at,
      // meeting_scheduled_at intact (audit + SDR can edit meeting if needed).
      await from(supabase, 'leads')
        .update({
          status: 'qualified',
          won_at: null,
          meeting_held_at: null,
        } as Record<string, unknown>)
        .eq('id', feedbackReq.lead_id)
        .eq('org_id', feedbackReq.org_id)
        .eq('status', 'won');

      // Audit trail in the lead timeline
      await from(supabase, 'interactions').insert({
        org_id: feedbackReq.org_id,
        lead_id: feedbackReq.lead_id,
        channel: 'system',
        type: 'sent',
        message_content: result === 'no_show'
          ? 'Closer marcou como não compareceu — lead reaberto'
          : 'Closer marcou como remarcada — lead reaberto',
        metadata: {
          system_event: result === 'no_show' ? 'meeting_unconfirmed' : 'meeting_rescheduled_by_closer',
          result,
          closer_id: feedbackReq.closer_id,
        },
      } as Record<string, unknown>);
    }

    // Notify SDR in background after response is sent
    after(() =>
      notifySdr(supabase, feedbackReq, result, rating, comment).catch((err) =>
        console.error('[api/feedback] SDR notification error:', err),
      ),
    );

    // Notify managers only when there's an actionable signal — keeps their inbox
    // clean on healthy feedbacks (meeting_done with good rating) while ensuring
    // they hear about: no-show, reschedule, or low rating.
    const isActionable =
      result === 'no_show'
      || result === 'rescheduled'
      || (typeof rating === 'number' && rating >= 1 && rating <= 2);

    if (isActionable) {
      after(() =>
        notifyManagers(supabase, feedbackReq, result, rating, comment).catch((err) =>
          console.error('[api/feedback] Manager notification error:', err),
        ),
      );
    }

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

  // Title and body vary by result — no_show/rescheduled reopen the lead and
  // need a stronger CTA so the SDR knows what to do next.
  let notifTitle: string;
  let notifBody: string;
  if (result === 'no_show') {
    notifTitle = `⚠️ ${leadName} reaberto — não compareceu`;
    notifBody = `${closerName} marcou que o lead não compareceu à reunião. Lead reaberto — retome o contato${comment ? `. Observação: ${comment}` : '.'}`;
  } else if (result === 'rescheduled') {
    notifTitle = `📅 ${leadName} reaberto — reunião remarcada`;
    notifBody = `${closerName} marcou que a reunião foi remarcada. Lead reaberto — combine nova data${comment ? `. Observação: ${comment}` : '.'}`;
  } else {
    notifTitle = `${closerName} respondeu o feedback`;
    notifBody = `${leadName} — ${resultLabel} (${rating}/5)${comment ? `: ${comment}` : ''}`;
  }

  // Create in-app notification for the SDR (triggers Realtime)
  try {
    await createNotification({
      org_id: feedbackReq.org_id,
      user_id: sdrUserId,
      type: 'closer_feedback',
      title: notifTitle,
      body: notifBody,
      resource_type: 'lead',
      resource_id: feedbackReq.lead_id,
      metadata: { closer_name: closerName, result, rating, comment },
    });
  } catch (err) {
    console.error('[api/feedback] Failed to create notification:', err);
  }
  // Rating is only required for meeting_done; no_show/rescheduled responses
  // have rating=null. Guard the star renderer so we don't crash.
  const safeRating = typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : 0;
  const ratingLabel = safeRating > 0 ? (RATING_LABELS[safeRating] ?? `${safeRating}/5`) : '—';
  const stars = safeRating > 0 ? '★'.repeat(safeRating) + '☆'.repeat(5 - safeRating) : '';
  const isReopen = result === 'no_show' || result === 'rescheduled';
  const ctaLine = result === 'no_show'
    ? 'Lead reaberto. Retome o contato com o lead.'
    : result === 'rescheduled'
      ? 'Lead reaberto. Combine nova data da reunião.'
      : '';
  const subjectPrefix = isReopen ? 'Lead reaberto' : 'Feedback da reunião';

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
                ${safeRating > 0 ? `
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #e5e7eb;">
                    <span style="color: #6b7280; font-size: 13px;">Qualidade do lead</span><br>
                    <span style="color: #E53935; font-size: 20px; letter-spacing: 2px;">${stars}</span>
                    <span style="color: #1a1a1a; font-size: 14px; margin-left: 8px;">${ratingLabel} (${safeRating}/5)</span>
                  </td>
                </tr>
                ` : ''}
                ${comment ? `
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #e5e7eb;">
                    <span style="color: #6b7280; font-size: 13px;">Observações do closer</span><br>
                    <span style="color: #1a1a1a; font-size: 14px;">${comment}</span>
                  </td>
                </tr>
                ` : ''}
              </table>

              ${ctaLine ? `
              <p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;margin:0 0 20px;color:#78350f;font-size:14px;line-height:1.5;">
                <strong>Próximo passo:</strong> ${ctaLine}
              </p>
              ` : ''}

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
    subject: `${subjectPrefix}: ${leadName} — ${resultLabel}`,
    html: htmlBody,
  });
}

/**
 * Notify managers when a feedback signals something actionable:
 * no_show, rescheduled, or low rating (<= 2). Healthy feedbacks
 * (meeting_done with rating >= 3) are intentionally silent for managers
 * to avoid inbox noise.
 */
async function notifyManagers(
  supabase: ReturnType<typeof createServiceRoleClient>,
  feedbackReq: FeedbackRequestFull,
  result: string,
  rating: number,
  comment: string | null,
) {
  // Pull lead, closer, sdr names for context
  const { data: lead } = (await from(supabase, 'leads')
    .select('nome_fantasia, razao_social, won_by, assigned_to')
    .eq('id', feedbackReq.lead_id)
    .is('deleted_at', null)
    .single()) as { data: { nome_fantasia: string | null; razao_social: string | null; won_by: string | null; assigned_to: string | null } | null };

  if (!lead) return;

  const { data: closer } = (await from(supabase, 'closers')
    .select('name')
    .eq('id', feedbackReq.closer_id)
    .single()) as { data: { name: string } | null };

  const closerName = closer?.name ?? 'Closer';
  const leadName = lead.nome_fantasia ?? lead.razao_social ?? 'Lead';
  const resultLabel = RESULT_LABELS[result] ?? result;
  const sdrUserId = lead.won_by ?? lead.assigned_to;

  // Resolve SDR name (best-effort)
  let sdrName = 'Pré-vendedor';
  if (sdrUserId) {
    const { data: authData } = await supabase.auth.admin.getUserById(sdrUserId);
    sdrName = authData?.user?.user_metadata?.name as string
      ?? authData?.user?.email
      ?? sdrName;
  }

  // Build the reason line — what made this feedback actionable
  const reasons: string[] = [];
  if (result === 'no_show') reasons.push('reunião não aconteceu (no-show)');
  if (result === 'rescheduled') reasons.push('closer remarcou a reunião');
  if (typeof rating === 'number' && rating >= 1 && rating <= 2) {
    reasons.push(`closer avaliou o lead com nota baixa (${rating}/5)`);
  }
  const reasonLine = reasons.join(' • ');

  // List active managers in the org
  const { data: managers } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', feedbackReq.org_id)
    .eq('role', 'manager')
    .eq('status', 'active')) as { data: Array<{ user_id: string }> | null };

  if (!managers?.length) return;

  // In-app notification (Realtime) for each manager
  await createNotificationsForOrgMembers({
    orgId: feedbackReq.org_id,
    type: 'closer_feedback',
    title: `⚠️ Feedback exige atenção — ${leadName}`,
    body: `${closerName} → ${resultLabel}. ${reasonLine}${comment ? `. "${comment}"` : ''}`,
    resourceType: 'lead',
    resourceId: feedbackReq.lead_id,
    metadata: { closer_name: closerName, result, rating, comment, actionable: true },
    roleFilter: 'manager',
  }).catch((err) => console.error('[api/feedback/notifyManagers] in-app failed:', err));

  // Email each manager — same template style as the SDR mail
  const safeRating = typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : 0;
  const ratingLabel = safeRating > 0 ? (RATING_LABELS[safeRating] ?? `${safeRating}/5`) : '—';
  const stars = safeRating > 0 ? '★'.repeat(safeRating) + '☆'.repeat(5 - safeRating) : '';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background: #1a1a1a; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">EnriqueceAI</h1>
          <p style="color: #9ca3af; margin: 4px 0 0; font-size: 13px;">Alerta para o gestor</p>
        </td></tr>
        <tr><td style="padding: 32px;">
          <h2 style="margin: 0 0 16px; font-size: 18px; color: #1a1a1a;">Feedback que exige atenção</h2>
          <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 16px;">
            <strong>${closerName}</strong> respondeu o feedback da reunião com <strong>${leadName}</strong> (Pré-vendedor: ${sdrName}).
          </p>
          <p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;margin:0 0 20px;color:#78350f;font-size:14px;line-height:1.5;">
            <strong>Motivo do alerta:</strong> ${reasonLine}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <tr><td style="padding: 8px 0;">
              <span style="color: #6b7280; font-size: 13px;">Resultado da reunião</span><br>
              <strong style="color: #1a1a1a; font-size: 15px;">${resultLabel}</strong>
            </td></tr>
            ${safeRating > 0 ? `
            <tr><td style="padding: 8px 0; border-top: 1px solid #e5e7eb;">
              <span style="color: #6b7280; font-size: 13px;">Qualidade do lead</span><br>
              <span style="color: #E53935; font-size: 20px; letter-spacing: 2px;">${stars}</span>
              <span style="color: #1a1a1a; font-size: 14px; margin-left: 8px;">${ratingLabel} (${safeRating}/5)</span>
            </td></tr>
            ` : ''}
            ${comment ? `
            <tr><td style="padding: 8px 0; border-top: 1px solid #e5e7eb;">
              <span style="color: #6b7280; font-size: 13px;">Observações do closer</span><br>
              <span style="color: #1a1a1a; font-size: 14px;">${comment}</span>
            </td></tr>
            ` : ''}
          </table>
          <p style="color: #9ca3af; font-size: 13px; margin: 0; line-height: 1.5;">
            Acesse a plataforma para ver detalhes e acompanhar o lead.
          </p>
        </td></tr>
        <tr><td style="background: #f9fafb; padding: 16px 32px; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            Você recebe este email porque é manager da organização. Gestores são notificados apenas em casos acionáveis (no-show, reagendamento ou avaliação baixa).
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  // Send to each manager in parallel
  await Promise.all(
    managers.map(async (m) => {
      const { data: authData } = await supabase.auth.admin.getUserById(m.user_id);
      const email = authData?.user?.email;
      if (!email) return;
      try {
        await sendPlatformEmail({
          to: email,
          subject: `[Gestor] ${leadName} — ${resultLabel}`,
          html: htmlBody,
        });
      } catch (err) {
        console.error('[api/feedback/notifyManagers] email failed for', email, err);
      }
    }),
  );
}
