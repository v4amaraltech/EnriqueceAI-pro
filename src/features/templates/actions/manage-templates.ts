'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { createTemplateSchema, updateTemplateSchema, TEMPLATE_VARIABLE_REGEX } from '../index';
import type { MessageTemplateRow } from '../../cadences/types';

function extractVarsFromText(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VARIABLE_REGEX)].map((m) => m[1]).filter((v): v is string => v != null))];
}

export async function createTemplate(
  input: Record<string, unknown>,
): Promise<ActionResult<MessageTemplateRow>> {
  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { orgId, userId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { name, channel, subject, body } = parsed.data;
  const allText = `${subject ?? ''} ${body}`;
  const variables_used = extractVarsFromText(allText);

  const { data, error } = (await from(supabase, 'message_templates')
    .insert({
      org_id: orgId,
      name,
      channel,
      subject: subject ?? null,
      body,
      variables_used,
      is_system: false,
      created_by: userId,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: MessageTemplateRow | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao criar template' };
  }

  return { success: true, data: data! };
}

export async function updateTemplate(
  templateId: string,
  input: Record<string, unknown>,
): Promise<ActionResult<MessageTemplateRow>> {
  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const { orgId, userId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  // Check template exists and ownership
  const { data: existing } = (await from(supabase, 'message_templates')
    .select('is_system, created_by')
    .eq('id', templateId)
    .eq('org_id', orgId)
    .single()) as { data: { is_system: boolean; created_by: string | null } | null };

  if (!existing) {
    return { success: false, error: 'Template não encontrado' };
  }

  if (existing.is_system) {
    return { success: false, error: 'Templates de sistema não podem ser editados' };
  }

  // SDR can only edit own templates
  if (role === 'sdr' && existing.created_by !== userId) {
    return { success: false, error: 'Você só pode editar seus próprios templates' };
  }

  const updates: Record<string, unknown> = { ...parsed.data };

  // Recalculate variables_used if body or subject changed
  if (parsed.data.body || parsed.data.subject !== undefined) {
    // Need full data to calculate
    const { data: full } = (await from(supabase, 'message_templates')
      .select('subject, body')
      .eq('id', templateId)
      .single()) as { data: { subject: string | null; body: string } | null };

    if (full) {
      const newSubject = parsed.data.subject !== undefined ? parsed.data.subject : full.subject;
      const newBody = parsed.data.body ?? full.body;
      updates.variables_used = extractVarsFromText(`${newSubject ?? ''} ${newBody}`);
    }
  }

  const { data, error } = (await from(supabase, 'message_templates')
    .update(updates as Record<string, unknown>)
    .eq('id', templateId)
    .eq('org_id', orgId)
    .select('*')
    .single()) as { data: MessageTemplateRow | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao atualizar template' };
  }

  return { success: true, data: data! };
}

export async function deleteTemplate(
  templateId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const { orgId, userId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  // Check exists and ownership
  const { data: existing } = (await from(supabase, 'message_templates')
    .select('is_system, created_by')
    .eq('id', templateId)
    .eq('org_id', orgId)
    .single()) as { data: { is_system: boolean; created_by: string | null } | null };

  if (!existing) {
    return { success: false, error: 'Template não encontrado' };
  }

  if (existing.is_system) {
    return { success: false, error: 'Templates de sistema não podem ser deletados' };
  }

  // SDR can only delete own templates
  if (role === 'sdr' && existing.created_by !== userId) {
    return { success: false, error: 'Você só pode deletar seus próprios templates' };
  }

  const { error } = await from(supabase, 'message_templates')
    .delete()
    .eq('id', templateId)
    .eq('org_id', orgId);

  if (error) {
    return { success: false, error: 'Erro ao deletar template' };
  }

  return { success: true, data: { deleted: true } };
}

export async function duplicateTemplate(
  templateId: string,
): Promise<ActionResult<MessageTemplateRow>> {
  const { orgId, userId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { data: source } = (await from(supabase, 'message_templates')
    .select('*')
    .eq('id', templateId)
    .eq('org_id', orgId)
    .single()) as { data: MessageTemplateRow | null };

  if (!source) {
    return { success: false, error: 'Template não encontrado' };
  }

  // SDR can only duplicate own templates or system templates
  if (role === 'sdr' && !source.is_system && source.created_by !== userId) {
    return { success: false, error: 'Você só pode duplicar seus próprios templates' };
  }

  const { data, error } = (await from(supabase, 'message_templates')
    .insert({
      org_id: orgId,
      name: `${source.name} (cópia)`,
      channel: source.channel,
      subject: source.subject,
      body: source.body,
      variables_used: source.variables_used,
      is_system: false,
      created_by: userId,
    } as Record<string, unknown>)
    .select('*')
    .single()) as { data: MessageTemplateRow | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao duplicar template' };
  }

  return { success: true, data: data! };
}
