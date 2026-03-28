'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface OrgSettings {
  abm_enabled: boolean;
  abm_group_field: string;
  lead_visibility_mode: 'all' | 'own' | 'team';
}

type ManagerOrg = Awaited<ReturnType<typeof getManagerOrgId>>;

export async function getOrgSettings(): Promise<ActionResult<OrgSettings>> {
  let orgId: string;
  let supabase: ManagerOrg['supabase'];
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await from(supabase, 'organizations')
    .select('abm_enabled, abm_group_field, lead_visibility_mode')
    .eq('id', orgId)
    .single()) as { data: OrgSettings | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao carregar configurações' };
  return { success: true, data };
}

export async function saveAbmSettings(
  enabled: boolean,
  groupField: string,
): Promise<ActionResult<{ saved: true }>> {
  let orgId: string;
  let supabase: ManagerOrg['supabase'];
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const trimmed = groupField.trim();
  if (!trimmed) return { success: false, error: 'Campo de agrupamento é obrigatório' };

  const { error } = await from(supabase, 'organizations')
    .update({ abm_enabled: enabled, abm_group_field: trimmed })
    .eq('id', orgId);

  if (error) return { success: false, error: 'Erro ao salvar configuração ABM' };
  revalidatePath('/settings/prospecting');
  return { success: true, data: { saved: true } };
}

export async function saveLeadVisibility(
  mode: 'all' | 'own' | 'team',
): Promise<ActionResult<{ saved: true }>> {
  let orgId: string;
  let supabase: ManagerOrg['supabase'];
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const validModes = ['all', 'own', 'team'];
  if (!validModes.includes(mode)) return { success: false, error: 'Modo de visibilidade inválido' };

  const { error } = await from(supabase, 'organizations')
    .update({ lead_visibility_mode: mode })
    .eq('id', orgId);

  if (error) return { success: false, error: 'Erro ao salvar modo de acesso' };
  revalidatePath('/settings/prospecting');
  return { success: true, data: { saved: true } };
}
