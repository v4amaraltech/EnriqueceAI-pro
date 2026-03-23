'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { createActivityTemplateSchema, updateActivityTemplateSchema } from '../schemas';
import type { ActivityTemplateRow } from '../types';

export async function createActivityTemplate(
  input: Record<string, unknown>,
): Promise<ActionResult<ActivityTemplateRow>> {
  const parsed = createActivityTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { orgId, userId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { name, channel, instructions } = parsed.data;

  const { data, error } = (await from(supabase, 'activity_templates')
    .insert({
      org_id: orgId,
      name,
      channel,
      instructions,
      created_by: userId,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: ActivityTemplateRow | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao criar template de atividade' };
  }

  return { success: true, data: data! };
}

export async function updateActivityTemplate(
  templateId: string,
  input: Record<string, unknown>,
): Promise<ActionResult<ActivityTemplateRow>> {
  const parsed = updateActivityTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { orgId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { data, error } = (await from(supabase, 'activity_templates')
    .update(parsed.data as Record<string, unknown>)
    .eq('id', templateId)
    .eq('org_id', orgId)
    .select('*')
    .single()) as { data: ActivityTemplateRow | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao atualizar template de atividade' };
  }

  return { success: true, data: data! };
}

export async function deleteActivityTemplate(
  templateId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { error } = await from(supabase, 'activity_templates')
    .delete()
    .eq('id', templateId)
    .eq('org_id', orgId);

  if (error) {
    return { success: false, error: 'Erro ao deletar template de atividade' };
  }

  return { success: true, data: { deleted: true } };
}
