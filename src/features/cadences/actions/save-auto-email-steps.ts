'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { saveAutoEmailCadenceSchema } from '../cadence.schemas';
import { extractVariables } from '../utils/render-template';

interface SaveResult {
  saved: number;
  template_ids: string[];
}

export async function saveAutoEmailSteps(
  input: Record<string, unknown>,
): Promise<ActionResult<SaveResult>> {
  const parsed = saveAutoEmailCadenceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { cadence_id, steps } = parsed.data;
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Verify org membership
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Verify cadence belongs to org and is editable
  const { data: cadence } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('id, status, type')
    .eq('id', cadence_id)
    .eq('org_id', member.org_id)
    .is('deleted_at', null)
    .single()) as { data: { id: string; status: string; type: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  if (cadence.type !== 'auto_email') {
    return { success: false, error: 'Esta ação é apenas para cadências de e-mail automático' };
  }

  if (cadence.status !== 'draft' && cadence.status !== 'paused') {
    return { success: false, error: 'Cadência precisa estar em rascunho ou pausada para editar passos' };
  }

  // Delete existing steps and their inline templates
  const { data: existingSteps } = (await (supabase
    .from('cadence_steps') as ReturnType<typeof supabase.from>)
    .select('template_id')
    .eq('cadence_id', cadence_id)) as { data: Array<{ template_id: string | null }> | null };

  // Delete existing steps
  const { error: deleteStepsError } = await (supabase
    .from('cadence_steps') as ReturnType<typeof supabase.from>)
    .delete()
    .eq('cadence_id', cadence_id);

  if (deleteStepsError) {
    return { success: false, error: 'Erro ao limpar passos existentes' };
  }

  // Delete orphaned inline templates (only those belonging to this cadence)
  const templateIds = (existingSteps ?? [])
    .map((s) => s.template_id)
    .filter((id): id is string => id != null);

  if (templateIds.length > 0) {
    await (supabase
      .from('message_templates') as ReturnType<typeof supabase.from>)
      .delete()
      .in('id', templateIds)
      .eq('org_id', member.org_id);
  }

  // Create templates and steps for each new step
  const newTemplateIds: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const variablesUsed = extractVariables(`${step.subject} ${step.body}`);

    // Create inline template
    const { data: template, error: templateError } = (await (supabase
      .from('message_templates') as ReturnType<typeof supabase.from>)
      .insert({
        org_id: member.org_id,
        name: `Auto Email - Step ${i + 1}`,
        channel: 'email',
        subject: step.subject,
        body: step.body,
        variables_used: variablesUsed,
        is_system: false,
        created_by: user.id,
      } as Record<string, unknown>)
      .select('id')
      .single()) as { data: { id: string } | null; error: { message: string } | null };

    if (templateError || !template) {
      return { success: false, error: `Erro ao criar template do step ${i + 1}` };
    }

    newTemplateIds.push(template.id);

    // Create cadence step
    const { error: stepError } = await (supabase
      .from('cadence_steps') as ReturnType<typeof supabase.from>)
      .insert({
        cadence_id,
        step_order: i + 1,
        channel: 'email',
        template_id: template.id,
        delay_days: i === 0 ? 0 : step.delay_days,
        delay_hours: i === 0 ? 0 : step.delay_hours,
        ai_personalization: step.ai_personalization,
        reply_type: i === 0 ? 'new_conversation' : (step.reply_type ?? 'new_conversation'),
      } as Record<string, unknown>);

    if (stepError) {
      return { success: false, error: `Erro ao criar step ${i + 1}` };
    }
  }

  // Update total_steps
  await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .update({ total_steps: steps.length } as Record<string, unknown>)
    .eq('id', cadence_id);

  return { success: true, data: { saved: steps.length, template_ids: newTemplateIds } };
}
