'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult, getManagerOrgId } from '@/lib/auth/get-org-id';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

export type { CustomFieldRow } from '../types/custom-field';
import type { CustomFieldRow } from '../types/custom-field';

function customFieldsFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return supabase.from('custom_fields');
}

export async function listCustomFields(): Promise<ActionResult<CustomFieldRow[]>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await customFieldsFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as { data: CustomFieldRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar campos personalizados' };
  return { success: true, data: data ?? [] };
}

export async function addCustomField(
  fieldName: string,
  fieldType: 'text' | 'number' | 'date' | 'select',
  options?: string[],
  settings?: { is_visible?: boolean; is_required_won?: boolean; is_required_lost?: boolean },
): Promise<ActionResult<CustomFieldRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const trimmed = fieldName.trim();
  if (!trimmed) return { success: false, error: 'Nome do campo é obrigatório' };

  if (fieldType === 'select' && (!options || options.length === 0)) {
    return { success: false, error: 'Campos do tipo select precisam de pelo menos uma opção' };
  }

  const { data: maxRow } = (await customFieldsFrom(supabase)
    .select('sort_order')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()) as { data: { sort_order: number } | null };

  const nextOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = (await customFieldsFrom(supabase)
    .insert({
      org_id: orgId,
      field_name: trimmed,
      field_type: fieldType,
      options: fieldType === 'select' ? options : null,
      sort_order: nextOrder,
      is_visible: settings?.is_visible ?? true,
      is_required_won: settings?.is_required_won ?? false,
      is_required_lost: settings?.is_required_lost ?? false,
    })
    .select()
    .single()) as { data: CustomFieldRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao adicionar campo' };
  return { success: true, data };
}

export async function updateCustomField(
  id: string,
  fieldName: string,
  fieldType: 'text' | 'number' | 'date' | 'select',
  options?: string[],
  settings?: { is_visible?: boolean; is_required_won?: boolean; is_required_lost?: boolean },
): Promise<ActionResult<CustomFieldRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const trimmed = fieldName.trim();
  if (!trimmed) return { success: false, error: 'Nome do campo é obrigatório' };

  if (fieldType === 'select' && (!options || options.length === 0)) {
    return { success: false, error: 'Campos do tipo select precisam de pelo menos uma opção' };
  }

  const { data, error } = (await customFieldsFrom(supabase)
    .update({
      field_name: trimmed,
      field_type: fieldType,
      options: fieldType === 'select' ? options : null,
      ...(settings && {
        is_visible: settings.is_visible,
        is_required_won: settings.is_required_won,
        is_required_lost: settings.is_required_lost,
      }),
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single()) as { data: CustomFieldRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao atualizar campo' };
  return { success: true, data };
}

export async function deleteCustomField(id: string): Promise<ActionResult<{ deleted: true }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await customFieldsFrom(supabase)
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: 'Erro ao remover campo' };
  return { success: true, data: { deleted: true } };
}

export async function updateCustomFieldSettings(
  id: string,
  settings: { is_visible?: boolean; is_required_won?: boolean; is_required_lost?: boolean },
): Promise<ActionResult<CustomFieldRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await customFieldsFrom(supabase)
    .update(settings as Record<string, unknown>)
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single()) as { data: CustomFieldRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao atualizar configuração do campo' };
  return { success: true, data };
}

/** List visible custom fields — readable by any org member (not just managers). */
export async function listVisibleCustomFields(): Promise<ActionResult<CustomFieldRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await customFieldsFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .eq('is_visible', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as { data: CustomFieldRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar campos personalizados' };
  return { success: true, data: data ?? [] };
}
