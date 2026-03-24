'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

export async function archiveLead(
  leadId: string,
): Promise<ActionResult<void>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await from(supabase, 'leads')
    .update({ status: 'archived' } as Record<string, unknown>)
    .eq('id', leadId)
    .eq('org_id', member.org_id);

  if (error) {
    return { success: false, error: 'Erro ao arquivar lead' };
  }

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: undefined };
}

export async function fetchLossReasons(): Promise<ActionResult<LossReasonRow[]>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await supabase
    .from('loss_reasons')
    .select('*')
    .eq('org_id', member.org_id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as { data: LossReasonRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar motivos de perda' };
  return { success: true, data: data ?? [] };
}

export async function markLeadAsLost(
  leadId: string,
  lossReasonId: string,
  lossNotes?: string,
): Promise<ActionResult<void>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // 1. Update lead status to unqualified
  const { error: leadError } = await from(supabase, 'leads')
    .update({ status: 'unqualified' } as Record<string, unknown>)
    .eq('id', leadId)
    .eq('org_id', member.org_id);

  if (leadError) {
    return { success: false, error: 'Erro ao marcar lead como perdido' };
  }

  // Dispatch lead.unqualified webhook
  dispatchWebhookEvent(supabase, member.org_id, 'lead.unqualified', {
    lead_id: leadId,
    loss_reason_id: lossReasonId,
    loss_notes: lossNotes ?? null,
  }).catch(() => {});

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

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: undefined };
}

export async function scheduleNewProspection(
  leadId: string,
  cadenceId: string,
  startDate: string,
): Promise<ActionResult<void>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Validate cadence is active and belongs to org
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, status')
    .eq('id', cadenceId)
    .eq('org_id', member.org_id)
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
      current_step: 1,
      status: 'paused',
      enrolled_by: user.id,
      scheduled_start_at: startDate,
    } as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (insertError || !enrollment) {
    return { success: false, error: 'Erro ao agendar prospecção' };
  }

  // Set next_step_due to scheduled date (trigger won't fire — not updating status or current_step)
  await from(supabase, 'cadence_enrollments')
    .update({ next_step_due: startDate } as Record<string, unknown>)
    .eq('id', enrollment.id);

  return { success: true, data: undefined };
}
