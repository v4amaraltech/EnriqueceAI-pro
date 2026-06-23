'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { logLeadEvent } from './log-lead-event';

/** Next business day (Mon–Fri) at 09:00 BRT, as a UTC ISO string. */
function nextBusinessDayAt9hBRT(now: Date): string {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)).toISOString();
}

interface LeadNoShowRow {
  id: string;
  status: string;
  assigned_to: string | null;
  won_by: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  meeting_scheduled_at: string | null;
}

/**
 * Manual "Reunião não aconteceu" (no-show) — disparado pelo SDR no lead.
 *
 * Complementa o cron `meeting-outcome-check`: o SDR não precisa esperar o vigia
 * nem torcer o significado de "Ganho/Perdido". Os closers não logam no app, então
 * o caminho deles continua sendo o link de feedback tokenizado — esta ação é a
 * porta de entrada do SDR pro mesmo desfecho.
 *
 * Efeitos:
 *  - Auditoria na timeline (`meeting_no_show_manual`).
 *  - Se o lead estava 'won' (SDR marcou Ganho e depois percebeu o no-show),
 *    reabre pra 'qualified' e limpa won_at/meeting_held_at; senão só garante
 *    meeting_held_at nulo.
 *  - Garante um follow-up de telefone na fila do SDR (não empilha se já houver
 *    atividade pendente). A atividade pendente também faz o cron pular este lead.
 *  - Notifica os gestores (visibilidade), exceto quem disparou.
 */
export async function markMeetingNoShow(leadId: string): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, status, assigned_to, won_by, nome_fantasia, razao_social, meeting_scheduled_at')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: LeadNoShowRow | null };

  if (!lead) return { success: false, error: 'Lead não encontrado' };
  if (lead.status === 'unqualified') {
    return { success: false, error: 'Lead já está marcado como perdido. Reabra-o antes de registrar o no-show.' };
  }
  // Defense-in-depth: no-show only makes sense for a lead that had a meeting.
  // The button surfaces gate on this too, but the server must not trust them.
  if (!lead.meeting_scheduled_at) {
    return { success: false, error: 'Este lead não tem reunião agendada para registrar no-show.' };
  }

  const displayName = lead.nome_fantasia ?? lead.razao_social ?? 'Lead';
  const sdrUserId = lead.won_by ?? lead.assigned_to ?? userId;
  const wasWon = lead.status === 'won';

  // 1. Auditoria na timeline (antes de qualquer flip de status).
  await logLeadEvent(supabase, {
    orgId,
    leadId,
    userId,
    event: 'meeting_no_show_manual',
    message: 'SDR registrou que a reunião não aconteceu (no-show)',
  });

  // 2. Status: reabre se estava 'won'; sempre limpa meeting_held_at.
  const updates: Record<string, unknown> = { meeting_held_at: null };
  if (wasWon) {
    updates.status = 'qualified';
    updates.won_at = null;
  }
  const { error: leadError } = await from(supabase, 'leads')
    .update(updates)
    .eq('id', leadId)
    .eq('org_id', orgId);

  const qErr = handleQueryError(leadError, 'Erro ao registrar no-show', 'lead-noshow');
  if (qErr) return qErr;

  // 3. Follow-up de telefone na fila do SDR (service role; não empilha).
  const serviceClient = createServiceRoleClient();
  const { data: existing } = (await from(serviceClient, 'scheduled_activities')
    .select('id')
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .limit(1)) as { data: Array<{ id: string }> | null };

  if (!existing?.length) {
    await from(serviceClient, 'scheduled_activities').insert({
      org_id: orgId,
      lead_id: leadId,
      user_id: sdrUserId,
      channel: 'phone',
      scheduled_at: nextBusinessDayAt9hBRT(new Date()),
      status: 'pending',
      notes: 'No-show registrado pelo SDR — retomar o contato e definir Ganho/Perdido.',
    } as Record<string, unknown>);
  }

  // 4. Visibilidade pro gestor (exceto quem registrou).
  createNotificationsForOrgMembers({
    orgId,
    type: 'closer_feedback',
    title: `🚫 Reunião não aconteceu — ${displayName}`,
    body: wasWon
      ? 'O SDR registrou no-show. Lead reaberto e follow-up criado na fila para retomada.'
      : 'O SDR registrou que a reunião não aconteceu. Follow-up criado na fila para retomada.',
    resourceType: 'lead',
    resourceId: leadId,
    roleFilter: 'manager',
    excludeUserId: userId,
  }).catch((err) => console.error('[markMeetingNoShow] manager notification failed:', err));

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/atividades');

  return { success: true, data: undefined };
}
