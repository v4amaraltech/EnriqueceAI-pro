'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId } from '@/lib/auth/get-org-id';

import { createCadenceSchema, createCadenceStepSchema, updateCadenceSchema } from '../cadence.schemas';
import type { CadenceRow, CadenceStepRow } from '../types';

export async function createCadence(
  input: Record<string, unknown>,
): Promise<ActionResult<CadenceRow>> {
  const parsed = createCadenceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { orgId, userId, supabase } = await getAuthOrgId();

  const { data, error } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
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

  if (error) {
    return { success: false, error: 'Erro ao criar cadência' };
  }

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

  const { orgId, supabase } = await getAuthOrgId();

  const { data, error } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .update(parsed.data as Record<string, unknown>)
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .select('*')
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao atualizar cadência' };
  }

  return { success: true, data: data! };
}

export async function deleteCadence(
  cadenceId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { orgId, supabase } = await getAuthOrgId();

  // Soft delete
  const { error } = await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .update({ deleted_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', cadenceId)
    .eq('org_id', orgId);

  if (error) {
    return { success: false, error: 'Erro ao deletar cadência' };
  }

  return { success: true, data: { deleted: true } };
}

export async function activateCadence(
  cadenceId: string,
): Promise<ActionResult<CadenceRow>> {
  const { orgId, supabase } = await getAuthOrgId();

  // Check minimum 2 steps
  const { count } = (await (supabase
    .from('cadence_steps') as ReturnType<typeof supabase.from>)
    .select('id', { count: 'exact', head: true })
    .eq('cadence_id', cadenceId)) as { count: number | null };

  if ((count ?? 0) < 2) {
    return { success: false, error: 'Cadência precisa de no mínimo 2 passos para ser ativada' };
  }

  const { data, error } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .update({ status: 'active' } as Record<string, unknown>)
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .select('*')
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao ativar cadência' };
  }

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

  const { orgId, supabase } = await getAuthOrgId();

  // Verify cadence belongs to org
  const { data: cadence } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('id, total_steps')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; total_steps: number } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  const { data: step, error } = (await (supabase
    .from('cadence_steps') as ReturnType<typeof supabase.from>)
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

  if (error) {
    return { success: false, error: 'Erro ao adicionar passo' };
  }

  // Update total_steps
  await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .update({ total_steps: cadence.total_steps + 1 } as Record<string, unknown>)
    .eq('id', cadenceId);

  return { success: true, data: step! };
}

export async function removeCadenceStep(
  cadenceId: string,
  stepId: string,
): Promise<ActionResult<{ removed: boolean }>> {
  const { orgId, supabase } = await getAuthOrgId();

  // Verify cadence belongs to org
  const { data: cadence } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('id, total_steps')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; total_steps: number } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  const { error } = await (supabase
    .from('cadence_steps') as ReturnType<typeof supabase.from>)
    .delete()
    .eq('id', stepId)
    .eq('cadence_id', cadenceId);

  if (error) {
    return { success: false, error: 'Erro ao remover passo' };
  }

  // Update total_steps
  const newTotal = Math.max(0, cadence.total_steps - 1);
  await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .update({ total_steps: newTotal } as Record<string, unknown>)
    .eq('id', cadenceId);

  return { success: true, data: { removed: true } };
}

export async function enrollLeads(
  cadenceId: string,
  leadIds: string[],
  initialStatus: 'active' | 'paused' = 'active',
): Promise<ActionResult<{ enrolled: number; errors: string[] }>> {
  const { orgId, userId, supabase } = await getAuthOrgId();

  // Verify cadence is active
  const { data: cadence } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('id, status')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string } | null };

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
    await (supabase
      .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('cadence_id', cadenceId)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);

    const { error } = await (supabase
      .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
      .insert({
        cadence_id: cadenceId,
        lead_id: leadId,
        current_step: 1,
        status: initialStatus,
        enrolled_by: userId,
      } as Record<string, unknown>);

    if (error) {
      errors.push(`Lead ${leadId}: ${error.message ?? 'já inscrito ou erro'}`);
    } else {
      enrolled++;
    }
  }

  return { success: true, data: { enrolled, errors } };
}
