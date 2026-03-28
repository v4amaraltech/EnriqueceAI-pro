'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult, getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface StandardFieldSettingRow {
  id: string;
  org_id: string;
  field_key: string;
  is_visible: boolean;
  is_required_won: boolean;
  is_required_lost: boolean;
  options: string[] | null;
}

export async function listStandardFieldSettings(): Promise<ActionResult<StandardFieldSettingRow[]>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await from(supabase, 'standard_field_settings')
    .select('*')
    .eq('org_id', orgId)) as { data: StandardFieldSettingRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar configurações de campos padrão' };
  return { success: true, data: data ?? [] };
}

export async function listStandardFieldSettingsForMember(): Promise<ActionResult<StandardFieldSettingRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'standard_field_settings')
    .select('*')
    .eq('org_id', orgId)) as { data: StandardFieldSettingRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar configurações de campos padrão' };
  return { success: true, data: data ?? [] };
}

export async function upsertStandardFieldSetting(
  fieldKey: string,
  settings: { is_visible?: boolean; is_required_won?: boolean; is_required_lost?: boolean; options?: string[] | null },
): Promise<ActionResult<StandardFieldSettingRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const payload: Record<string, unknown> = {
    org_id: orgId,
    field_key: fieldKey,
    is_visible: settings.is_visible ?? true,
    is_required_won: settings.is_required_won ?? false,
    is_required_lost: settings.is_required_lost ?? false,
  };
  if (settings.options !== undefined) {
    payload.options = settings.options;
  }

  const { data, error } = (await from(supabase, 'standard_field_settings')
    .upsert(payload, { onConflict: 'org_id,field_key' })
    .select()
    .single()) as { data: StandardFieldSettingRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao atualizar configuração do campo padrão' };
  return { success: true, data };
}
