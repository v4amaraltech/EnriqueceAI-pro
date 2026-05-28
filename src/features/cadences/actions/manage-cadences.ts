'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { logLeadEvent, logLeadEventBulk } from '@/features/leads/actions/log-lead-event';

import { createCadenceSchema, createCadenceStepSchema, updateCadenceSchema } from '../cadence.schemas';
import type { CadenceRow, CadenceStepRow } from '../types';

export async function createCadence(
  input: Record<string, unknown>,
): Promise<ActionResult<CadenceRow>> {
  const parsed = createCadenceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'cadences')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      type: parsed.data.type,
      priority: parsed.data.priority,
      origin: parsed.data.origin,
      auto_loss_after_days: parsed.data.auto_loss_after_days ?? null,
      auto_loss_reason_id: parsed.data.auto_loss_reason_id ?? null,
      status: 'draft',
      total_steps: 0,
      created_by: userId,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  const qErr = handleQueryError(error, 'Erro ao criar cadência', 'cadences');
  if (qErr) return qErr;

  return { success: true, data: data! };
}

export async function updateCadence(
  cadenceId: string,
  input: Record<string, unknown>,
): Promise<ActionResult<CadenceRow>> {
  const parsed = updateCadenceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'cadences')
    .update(parsed.data as Record<string, unknown>)
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .select('*')
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  const qErr2 = handleQueryError(error, 'Erro ao atualizar cadência', 'cadences');
  if (qErr2) return qErr2;

  return { success: true, data: data! };
}

export async function deleteCadence(
  cadenceId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Soft delete — select the updated row to confirm it was actually modified
  const { data: updated, error } = await from(supabase, 'cadences')
    .update({ deleted_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle();

  const qErr3 = handleQueryError(error, 'Erro ao deletar cadência', 'deleteCadence');
  if (qErr3) return qErr3;

  if (!updated) {
    console.error('[deleteCadence] No rows affected for cadenceId:', cadenceId);
    return { success: false, error: 'Cadência não encontrada' };
  }

  revalidatePath('/cadences');
  return { success: true, data: { deleted: true } };
}

export async function activateCadence(
  cadenceId: string,
): Promise<ActionResult<CadenceRow>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Check minimum 2 steps
  const { count } = (await from(supabase, 'cadence_steps')
    .select('id', { count: 'exact', head: true })
    .eq('cadence_id', cadenceId)) as { count: number | null };

  if ((count ?? 0) < 2) {
    return { success: false, error: 'Cadência precisa de no mínimo 2 passos para ser ativada' };
  }

  const { data, error } = (await from(supabase, 'cadences')
    .update({ status: 'active' } as Record<string, unknown>)
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .select('*')
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  const qErr4 = handleQueryError(error, 'Erro ao ativar cadência', 'cadences');
  if (qErr4) return qErr4;

  return { success: true, data: data! };
}

export async function addCadenceStep(
  cadenceId: string,
  input: Record<string, unknown>,
): Promise<ActionResult<CadenceStepRow>> {
  const parsed = createCadenceStepSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Verify cadence belongs to org
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, total_steps')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; total_steps: number } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  const { data: step, error } = (await from(supabase, 'cadence_steps')
    .insert({
      cadence_id: cadenceId,
      step_order: parsed.data.step_order,
      channel: parsed.data.channel,
      template_id: parsed.data.template_id ?? null,
      delay_days: parsed.data.delay_days,
      delay_hours: parsed.data.delay_hours,
      ai_personalization: parsed.data.ai_personalization,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: CadenceStepRow | null; error: { message: string } | null };

  const qErr5 = handleQueryError(error, 'Erro ao adicionar passo', 'cadences');
  if (qErr5) return qErr5;

  // Update total_steps
  const { error: countErr } = await from(supabase, 'cadences')
    .update({ total_steps: cadence.total_steps + 1 } as Record<string, unknown>)
    .eq('id', cadenceId);
  if (countErr) console.error(`[addCadenceStep] Failed to update total_steps for cadence=${cadenceId}:`, countErr);

  return { success: true, data: step! };
}

export async function removeCadenceStep(
  cadenceId: string,
  stepId: string,
): Promise<ActionResult<{ removed: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Verify cadence belongs to org
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, total_steps')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; total_steps: number } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  const { error } = await from(supabase, 'cadence_steps')
    .delete()
    .eq('id', stepId)
    .eq('cadence_id', cadenceId);

  const qErr6 = handleQueryError(error, 'Erro ao remover passo', 'cadences');
  if (qErr6) return qErr6;

  // Update total_steps
  const newTotal = Math.max(0, cadence.total_steps - 1);
  const { error: countErr } = await from(supabase, 'cadences')
    .update({ total_steps: newTotal } as Record<string, unknown>)
    .eq('id', cadenceId);
  if (countErr) console.error(`[removeCadenceStep] Failed to update total_steps for cadence=${cadenceId}:`, countErr);

  return { success: true, data: { removed: true } };
}

export async function duplicateCadence(
  cadenceId: string,
): Promise<ActionResult<CadenceRow>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Fetch source cadence
  const { data: source, error: srcErr } = (await from(supabase, 'cadences')
    .select('*')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  if (srcErr || !source) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  // Fetch source steps
  const { data: steps } = (await from(supabase, 'cadence_steps')
    .select('*')
    .eq('cadence_id', cadenceId)
    .order('step_order', { ascending: true })) as { data: CadenceStepRow[] | null };

  // Create new cadence with all fields
  const { data: newCadence, error: createErr } = (await from(supabase, 'cadences')
    .insert({
      org_id: orgId,
      name: `${source.name.replace(/ \(cópia\)$/,'')} (cópia)`,
      description: source.description,
      type: source.type,
      priority: source.priority,
      origin: source.origin,
      auto_loss_after_days: source.auto_loss_after_days,
      auto_loss_reason_id: source.auto_loss_reason_id,
      status: 'draft',
      total_steps: 0,
      created_by: userId,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  if (createErr || !newCadence) {
    return { success: false, error: 'Erro ao duplicar cadência' };
  }

  // Copy steps
  if (steps && steps.length > 0) {
    const stepInserts = steps.map((s) => ({
      cadence_id: newCadence.id,
      step_order: s.step_order,
      channel: s.channel,
      template_id: s.template_id,
      delay_days: s.delay_days,
      delay_hours: s.delay_hours,
      ai_personalization: s.ai_personalization,
      activity_name: s.activity_name,
      instructions: s.instructions,
      reply_type: s.reply_type,
      template_id_b: s.template_id_b,
      ab_enabled: s.ab_enabled,
      ab_distribution: s.ab_distribution,
      ab_winner_variant: null,
      ab_winner_at: null,
      ab_enabled_at: null,
    } as Record<string, unknown>));

    const { error: stepsErr } = await from(supabase, 'cadence_steps').insert(stepInserts);
    if (stepsErr) console.error(`[duplicateCadence] Failed to copy steps for cadence=${newCadence.id}:`, stepsErr);

    // Update total_steps
    const { error: countErr } = await from(supabase, 'cadences')
      .update({ total_steps: steps.length } as Record<string, unknown>)
      .eq('id', newCadence.id);
    if (countErr) console.error(`[duplicateCadence] Failed to update total_steps for cadence=${newCadence.id}:`, countErr);

    newCadence.total_steps = steps.length;
  }

  return { success: true, data: newCadence };
}

export async function enrollLeads(
  cadenceId: string,
  leadIds: string[],
  initialStatus: 'active' | 'paused' = 'active',
): Promise<ActionResult<{ enrolled: number; errors: string[] }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Verify cadence is active
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, name, status')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; name: string; status: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  if (cadence.status !== 'active') {
    return { success: false, error: 'Cadência precisa estar ativa para inscrever leads' };
  }

  let enrolled = 0;
  const errors: string[] = [];

  for (const leadId of leadIds) {
    // Complete any existing active/paused enrollment for this lead in this cadence
    const { error: completeErr } = await from(supabase, 'cadence_enrollments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('cadence_id', cadenceId)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);
    if (completeErr) console.error(`[enrollLeads] Failed to complete previous enrollment for lead=${leadId}:`, completeErr);

    const { error } = await from(supabase, 'cadence_enrollments')
      .insert({
        cadence_id: cadenceId,
        lead_id: leadId,
        org_id: orgId,
        current_step: 1,
        status: initialStatus,
        enrolled_by: userId,
      } as Record<string, unknown>);

    if (error) {
      errors.push(`Lead ${leadId}: ${error.message ?? 'já inscrito ou erro'}`);
    } else {
      enrolled++;
      logLeadEvent(supabase, {
        orgId,
        leadId,
        userId,
        event: 'cadence_enrolled',
        message: `Inscrito na cadência: ${cadence.name}`,
        metadata: { cadence_id: cadenceId, cadence_name: cadence.name },
      });
    }
  }

  return { success: true, data: { enrolled, errors } };
}

/**
 * Switch leads from any active cadence to a new one.
 * Completes ALL active/paused enrollments across all cadences, then enrolls in the target.
 */
export async function switchLeadsCadence(
  targetCadenceId: string,
  leadIds: string[],
): Promise<ActionResult<{ enrolled: number; errors: string[] }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Verify target cadence is active
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id, status, name')
    .eq('id', targetCadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string; name: string } | null };

  if (!cadence) return { success: false, error: 'Cadência não encontrada' };
  if (cadence.status !== 'active') return { success: false, error: 'Cadência precisa estar ativa' };

  // Capture which leads currently have active/paused enrollments BEFORE closing
  // them, so the switch-out leaves a timeline trace. Without this, the lead's
  // exit from its prior cadence(s) was invisible (enrollLeads only logs the
  // new enrollment).
  const { data: priorEnrollments } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id')
    .in('lead_id', leadIds)
    .eq('org_id', orgId)
    .in('status', ['active', 'paused'])) as { data: Array<{ lead_id: string }> | null };
  const switchedLeadIds = [...new Set((priorEnrollments ?? []).map((e) => e.lead_id))];

  // Complete ALL active/paused enrollments for these leads (any cadence)
  for (const leadId of leadIds) {
    await from(supabase, 'cadence_enrollments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .eq('org_id', orgId)
      .in('status', ['active', 'paused']);
  }

  if (switchedLeadIds.length > 0) {
    await logLeadEventBulk(supabase, {
      orgId,
      leadIds: switchedLeadIds,
      userId,
      event: 'cadence_switched',
      message: `Cadência anterior encerrada — lead movido para "${cadence.name}"`,
      metadata: { cadence_id: targetCadenceId },
    });
  }

  // Now enroll in the target cadence
  return enrollLeads(targetCadenceId, leadIds);
}
