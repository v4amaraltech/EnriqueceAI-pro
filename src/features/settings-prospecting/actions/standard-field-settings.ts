'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';

export interface StandardFieldSettingRow {
  id: string;
  org_id: string;
  field_key: string;
  is_visible: boolean;
  is_required_won: boolean;
  is_required_lost: boolean;
}

export async function listStandardFieldSettings(): Promise<ActionResult<StandardFieldSettingRow[]>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await (supabase as any).from('standard_field_settings')
    .select('*')
    .eq('org_id', orgId)) as { data: StandardFieldSettingRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar configurações de campos padrão' };
  return { success: true, data: data ?? [] };
}

export async function upsertStandardFieldSetting(
  fieldKey: string,
  settings: { is_visible?: boolean; is_required_won?: boolean; is_required_lost?: boolean },
): Promise<ActionResult<StandardFieldSettingRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await (supabase as any).from('standard_field_settings')
    .upsert(
      {
        org_id: orgId,
        field_key: fieldKey,
        is_visible: settings.is_visible ?? true,
        is_required_won: settings.is_required_won ?? false,
        is_required_lost: settings.is_required_lost ?? false,
      },
      { onConflict: 'org_id,field_key' },
    )
    .select()
    .single()) as { data: StandardFieldSettingRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao atualizar configuração do campo padrão' };
  return { success: true, data };
}
