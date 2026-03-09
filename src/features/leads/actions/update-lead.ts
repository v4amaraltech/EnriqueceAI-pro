'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import type { LossReasonRow } from '@/features/settings-prospecting/actions/loss-reasons-crud';

import { recalcFitScoreForLead } from './recalc-fit-scores';

/**
 * Resume paused enrollments when lead data is updated.
 * Finds enrollments paused due to missing email/phone and reactivates them.
 */
async function resumePausedEnrollments(
  supabase: SupabaseClient,
  leadId: string,
  reasons: string[],
): Promise<number> {
  // Find paused enrollments that have a failed interaction with one of the given reasons
  const { data: failedInteractions } = (await from(supabase, 'interactions')
    .select('cadence_id')
    .eq('lead_id', leadId)
    .eq('type', 'failed')
    .filter('metadata->>error', 'in', `(${reasons.join(',')})`)
  ) as { data: Array<{ cadence_id: string }> | null };

  if (!failedInteractions?.length) return 0;

  const cadenceIds = [...new Set(failedInteractions.map((i) => i.cadence_id))];

  // Resume only enrollments that are paused AND belong to active cadences
  const { data: updated } = (await from(supabase, 'cadence_enrollments')
    .update({ status: 'active' } as Record<string, unknown>)
    .eq('lead_id', leadId)
    .eq('status', 'paused')
    .in('cadence_id', cadenceIds)
    .select('id')
  ) as { data: Array<{ id: string }> | null };

  const count = updated?.length ?? 0;
  if (count > 0) {
    console.warn(`[lead-update] Resumed ${count} paused enrollments for lead=${leadId} reasons=${reasons.join(',')}`);
  }
  return count;
}

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

export async function updateLead(
  leadId: string,
  updates: Record<string, unknown>,
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

  // Only allow safe fields
  const safeFields = ['razao_social', 'nome_fantasia', 'email', 'telefone', 'phones', 'status', 'notes', 'socios', 'instagram', 'linkedin', 'website', 'first_name', 'last_name', 'job_title', 'lead_source', 'is_inbound', 'email_bounced_at'];
  const safeUpdates: Record<string, unknown> = {};
  for (const key of safeFields) {
    if (key in updates) {
      safeUpdates[key] = updates[key];
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return { success: false, error: 'Nenhum campo válido para atualizar' };
  }

  // Fetch current lead to detect email/phone changes
  const { data: currentLead } = (await from(supabase, 'leads')
    .select('email, telefone, email_bounced_at')
    .eq('id', leadId)
    .eq('org_id', member.org_id)
    .single()) as { data: { email: string | null; telefone: string | null; email_bounced_at: string | null } | null };

  // If email is being updated and it changed, clear bounce flag
  const newEmail = safeUpdates.email as string | undefined;
  const emailChanged = newEmail !== undefined && newEmail !== currentLead?.email && newEmail;
  if (emailChanged && currentLead?.email_bounced_at) {
    safeUpdates.email_bounced_at = null;
  }

  const { error } = await from(supabase, 'leads')
    .update(safeUpdates as Record<string, unknown>)
    .eq('id', leadId)
    .eq('org_id', member.org_id);

  if (error) {
    return { success: false, error: 'Erro ao atualizar lead' };
  }

  // Resume paused enrollments when email/phone is added or changed
  const newTelefone = safeUpdates.telefone as string | undefined;
  const telefoneChanged = newTelefone !== undefined && newTelefone !== currentLead?.telefone && newTelefone;

  if (emailChanged || telefoneChanged) {
    const reasons: string[] = [];
    if (emailChanged) reasons.push('no_lead_email', 'email_bounced');
    if (telefoneChanged) reasons.push('invalid_phone');
    resumePausedEnrollments(supabase, leadId, reasons).catch(() => {
      // Fire-and-forget
    });
  }

  // Recalc fit score if relevant fields changed
  const fitScoreFields = ['razao_social', 'nome_fantasia', 'email', 'telefone', 'notes'];
  const hasRelevantChange = fitScoreFields.some((f) => f in safeUpdates);
  if (hasRelevantChange) {
    recalcFitScoreForLead(supabase, leadId, member.org_id).catch(() => {
      // Fire-and-forget: don't block the update response
    });
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
