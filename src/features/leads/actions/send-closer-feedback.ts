'use server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import {
  FEEDBACK_TTL_MS,
  deliverCloserFeedbackRequest,
  logFeedbackScheduledInteraction,
  resolveMeetingStart,
  type SendFeedbackChannelResult,
} from '@/features/leads/services/closer-feedback-delivery.service';

export type { SendFeedbackChannelResult } from '@/features/leads/services/closer-feedback-delivery.service';

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

interface PendingRequestRow {
  id: string;
  token: string;
  expires_at: string;
  sent_at: string | null;
}

/**
 * Garante o pedido de feedback do closer para a reunião atual e entrega o link
 * (e-mail via Resend + WhatsApp pela Evolution do gestor) — OU o deixa
 * agendado quando a reunião ainda não começou.
 *
 * `sent_at` da linha é o momento do envio REAL: NULL enquanto a reunião está
 * no futuro (ou enquanto os dois canais falham). O cron feedback-reminders
 * envia as linhas sem sent_at assim que leads.meeting_starts_at passa. Antes
 * (até 30/10/2026) o "Ganho" adiantado descartava tudo em silêncio e o closer
 * nunca recebia o link (caso NEXT360 Telecom).
 *
 * Chamada em after() pelo markLeadAsWon e de forma síncrona pelo
 * resendCloserFeedback.
 */
export async function sendCloserFeedbackEmail(params: SendFeedbackParams): Promise<SendFeedbackChannelResult> {
  const { leadId, orgId, closerId, closerName, closerEmail, closerPhone, leadName, senderUserId } = params;
  const supabase = createServiceRoleClient();
  const channels: SendFeedbackChannelResult = { email: 'failed', whatsapp: 'skipped' };

  try {
    // Pending request for this lead+closer (expired or not). The partial unique
    // index idx_feedback_unique_pending (lead_id, closer_id) WHERE responded_at
    // IS NULL ignores expires_at, so an expired-but-unanswered row would make a
    // fresh insert fail — we reactivate it instead (see below).
    const { data: pending } = (await from(supabase, 'closer_feedback_requests')
      .select('id, token, expires_at, sent_at')
      .eq('lead_id', leadId)
      .eq('closer_id', closerId)
      .is('responded_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: PendingRequestRow | null };

    const now = Date.now();
    const meetingStart = await resolveMeetingStart(supabase, leadId);
    const meetingInFuture = meetingStart !== null && meetingStart.getTime() > now;

    let request: { id: string; token: string; sent_at: string | null };
    // Só registra "agendado" na timeline quando o pedido nasce/renasce agora —
    // clicar "Reenviar" duas vezes antes da reunião não duplica o aviso.
    let freshlyScheduled = false;

    if (pending && new Date(pending.expires_at).getTime() > now) {
      // Reuse existing pending feedback request — don't create duplicate
      request = pending;
      console.warn('[closer-feedback] Reusing existing feedback request for lead=%s', leadId);
    } else {
      // Don't re-ask a closer who already CONFIRMED this meeting ("Realizada").
      // This happens when a lead is marked "Ganho" a second time (without a
      // reopen) after the feedback was already answered, spawning a duplicate
      // request for the same meeting (PR #18). Only `meeting_done` blocks: if
      // the closer answered "Remarcou"/"No-show", the lead was reopened and a
      // new "Ganho" means a NEW meeting — it must get its own feedback, even
      // within 24h (caso Bom Demais Alimentos, 29–30/09).
      // Janela = desde o início da reunião atual; sem reunião conhecida, 24h.
      const since = meetingStart ?? new Date(now - 24 * 60 * 60 * 1000);
      const { data: alreadyConfirmed } = (await from(supabase, 'closer_feedback_requests')
        .select('id')
        .eq('lead_id', leadId)
        .eq('closer_id', closerId)
        .eq('result', 'meeting_done')
        .gte('responded_at', since.toISOString())
        .limit(1)
        .maybeSingle()) as { data: { id: string } | null };

      if (alreadyConfirmed) {
        console.warn(
          '[closer-feedback] Skipping — closer=%s already confirmed the current meeting for lead=%s',
          closerId,
          leadId,
        );
        channels.emailError = 'already_answered_recently';
        return channels;
      }

      // Validade provisória: 7 dias a partir da reunião (ou de agora). O envio
      // real recarimba expires_at para contar do momento em que o link saiu.
      const provisionalExpiresAt = new Date((meetingInFuture ? meetingStart.getTime() : now) + FEEDBACK_TTL_MS).toISOString();

      if (pending) {
        // Expired but never answered: reactivate the same row (fresh window,
        // reminders reset, back to "not sent") instead of inserting — the
        // insert would hit idx_feedback_unique_pending and the closer would get
        // nothing.
        const { error: reactivateError } = (await from(supabase, 'closer_feedback_requests')
          .update({
            sent_at: null,
            expires_at: provisionalExpiresAt,
            reminder_count: 0,
            reminder_sent_at: null,
          } as Record<string, unknown>)
          .eq('id', pending.id)
          .is('responded_at', null)) as { error: { message: string } | null };

        if (reactivateError) {
          console.error('[closer-feedback] Failed to reactivate feedback request:', reactivateError.message);
          channels.emailError = reactivateError.message;
          return channels;
        }
        request = { id: pending.id, token: pending.token, sent_at: null };
        console.warn('[closer-feedback] Reactivated expired feedback request for lead=%s', leadId);
      } else {
        const { data: inserted, error: insertError } = (await from(supabase, 'closer_feedback_requests')
          .insert({
            org_id: orgId,
            lead_id: leadId,
            closer_id: closerId,
            sent_at: null,
            expires_at: provisionalExpiresAt,
          })
          .select('id, token')
          .single()) as { data: { id: string; token: string } | null; error: { message: string } | null };

        if (insertError || !inserted) {
          console.error('[closer-feedback] Failed to create feedback request:', insertError?.message);
          channels.emailError = insertError?.message ?? 'feedback_request_insert_failed';
          return channels;
        }
        request = { id: inserted.id, token: inserted.token, sent_at: null };
      }
      freshlyScheduled = meetingInFuture;
    }

    // Nunca cobrar uma reunião que ainda não aconteceu. A linha fica criada
    // (sent_at NULL) e o cron feedback-reminders manda o link quando a reunião
    // começar. Vale também para o reenvio manual e para o link reaproveitado.
    if (meetingInFuture) {
      if (freshlyScheduled) {
        await logFeedbackScheduledInteraction(supabase, {
          orgId,
          leadId,
          performedBy: senderUserId,
          closerName,
          meetingStart,
        });
      }
      console.warn(
        '[closer-feedback] Deferred — meeting still in future. lead=%s start=%s request=%s',
        leadId,
        meetingStart.toISOString(),
        request.id,
      );
      channels.email = 'scheduled';
      channels.emailError = 'meeting_in_future';
      channels.scheduledFor = meetingStart.toISOString();
      return channels;
    }

    return await deliverCloserFeedbackRequest(supabase, {
      requestId: request.id,
      token: request.token,
      orgId,
      leadId,
      closerName,
      closerEmail,
      closerPhone,
      leadName,
      performedBy: senderUserId,
      stampSentAt: request.sent_at === null,
    });
  } catch (err) {
    console.error('[closer-feedback] Unexpected error:', err);
    if (channels.email !== 'sent' && !channels.emailError) {
      channels.emailError = err instanceof Error ? err.message : String(err);
    }
  }
  return channels;
}
