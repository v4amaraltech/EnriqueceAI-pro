'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';
import { logLeadEvent } from './log-lead-event';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

export async function archiveLead(
  leadId: string,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { error } = await from(supabase, 'leads')
    .update({ status: 'archived' } as Record<string, unknown>)
    .eq('id', leadId)
    .eq('org_id', orgId);

  const qErr = handleQueryError(error, 'Erro ao arquivar lead', 'lead-lifecycle');
  if (qErr) return qErr;

  logLeadEvent(supabase, {
    orgId,
    leadId,
    userId: auth.data.userId,
    event: 'status_changed',
    message: 'Lead arquivado',
    metadata: { new_status: 'archived' },
  });

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: undefined };
}

export async function fetchLossReasons(): Promise<ActionResult<LossReasonRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'loss_reasons')
    .select('*')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as { data: LossReasonRow[] | null; error: unknown };

  const qErr2 = handleQueryError(error, 'Erro ao listar motivos de perda', 'lead-lifecycle');
  if (qErr2) return qErr2;
  return { success: true, data: data ?? [] };
}

export async function markLeadAsLost(
  leadId: string,
  lossReasonId: string,
  lossNotes?: string,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // 1. Update lead status to unqualified
  const { error: leadError } = await from(supabase, 'leads')
    .update({ status: 'unqualified' } as Record<string, unknown>)
    .eq('id', leadId)
    .eq('org_id', orgId);

  const qErr3 = handleQueryError(leadError, 'Erro ao marcar lead como perdido', 'lead-lifecycle');
  if (qErr3) return qErr3;

  // Dispatch lead.unqualified webhook
  dispatchWebhookEvent(supabase, orgId, 'lead.unqualified', {
    lead_id: leadId,
    loss_reason_id: lossReasonId,
    loss_notes: lossNotes ?? null,
  }).catch((err) => console.error('[webhook] lead.unqualified dispatch failed:', err));

  // 2. Complete active/paused enrollments with loss reason
  const enrollmentUpdate: Record<string, unknown> = {
    status: 'completed',
    loss_reason_id: lossReasonId,
    completed_at: new Date().toISOString(),
  };
  if (lossNotes) {
    enrollmentUpdate.loss_notes = lossNotes;
  }
  // cadence_enrollments has no org_id column — RLS via cadences.org_id handles isolation
  await from(supabase, 'cadence_enrollments')
    .update(enrollmentUpdate)
    .eq('lead_id', leadId)
    .in('status', ['active', 'paused']);

  // 3. Record system interaction for timeline visibility
  const { data: reason } = (await from(supabase, 'loss_reasons')
    .select('name')
    .eq('id', lossReasonId)
    .single()) as { data: { name: string } | null };

  const lossMessage = `Lead marcado como perdido — Motivo: ${reason?.name ?? 'Desconhecido'}${lossNotes ? ` | Obs: ${lossNotes}` : ''}`;
  await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'system',
      type: 'sent',
      message_content: lossMessage,
      performed_by: auth.data.userId,
      metadata: { system_event: 'lead_lost', loss_reason_id: lossReasonId, loss_reason_name: reason?.name },
    } as Record<string, unknown>);

  // Notify managers that a lead was lost
  const leadName = (await from(supabase, 'leads').select('nome_fantasia, razao_social').eq('id', leadId).single() as { data: { nome_fantasia: string | null; razao_social: string | null } | null }).data;
  const displayName = leadName?.nome_fantasia ?? leadName?.razao_social ?? 'Lead';
  createNotificationsForOrgMembers({
    orgId,
    type: 'lead_lost',
    title: `Lead perdido: ${displayName}`,
    body: `Motivo: ${reason?.name ?? 'Desconhecido'}`,
    resourceType: 'lead',
    resourceId: leadId,
    roleFilter: 'manager',
    excludeUserId: auth.data.userId,
  }).catch((err) => console.error('[notification] lead_lost failed:', err));

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/atividades');

  return { success: true, data: undefined };
}

export async function scheduleNewProspection(
  leadId: string,
  cadenceId: string,
  startDate: string,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Validate cadence is active and belongs to org
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, status')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  if (cadence.status !== 'active') {
    return { success: false, error: 'Cadência precisa estar ativa' };
  }

  // Complete any existing active/paused enrollment for this lead in this cadence
  await from(supabase, 'cadence_enrollments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('cadence_id', cadenceId)
    .eq('lead_id', leadId)
    .in('status', ['active', 'paused']);

  // Create paused enrollment with scheduled_start_at
  const { data: enrollment, error: insertError } = (await from(supabase, 'cadence_enrollments')
    .insert({
      cadence_id: cadenceId,
      lead_id: leadId,
      org_id: orgId,
      current_step: 1,
      status: 'paused',
      enrolled_by: userId,
      scheduled_start_at: startDate,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  const qErr4 = handleQueryError(insertError, 'Erro ao agendar prospecção', 'lead-lifecycle');
  if (qErr4 || !enrollment) return qErr4 ?? { success: false, error: 'Erro ao agendar prospecção' };

  // Set next_step_due to scheduled date (trigger won't fire — not updating status or current_step)
  await from(supabase, 'cadence_enrollments')
    .update({ next_step_due: startDate } as Record<string, unknown>)
    .eq('id', enrollment.id);

  return { success: true, data: undefined };
}
