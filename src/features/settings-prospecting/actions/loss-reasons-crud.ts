'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

export interface LossReasonRow {
  id: string;
  org_id: string;
  name: string;
  is_system: boolean;
  sort_order: number;
  created_at: string;
}

const DEFAULT_REASONS = [
  'Adolescente/Criança',
  'Blocklist',
  'Cliente',
  'Cliente oculto',
  'Contatos inválidos',
  'Deixou de responder',
  'Duplicado',
  'Engano/Não Lembra',
  'Ex-cliente (detrator)',
  'Não ICP',
  'Nunca respondeu',
  'Pessoa Física',
  'Sem autoridade',
  'Sem budget',
  'Sem interesse',
  'Sem necessidade',
  'Sem timing',
  'Serviço fora de escopo',
  'SPAM',
];

// Helper: typed query builder for loss_reasons
function lossReasonsFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return from(supabase, 'loss_reasons');
}

export async function listLossReasons(): Promise<ActionResult<LossReasonRow[]>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Check if org has any reasons; if not, seed defaults
  const { data: existing, error: countError } = (await lossReasonsFrom(supabase)
    .select('id')
    .eq('org_id', orgId)
    .limit(1)) as { data: { id: string }[] | null; error: unknown };

  if (!countError && (!existing || existing.length === 0)) {
    const seedRows = DEFAULT_REASONS.map((name, i) => ({
      org_id: orgId,
      name,
      is_system: true,
      sort_order: i + 1,
    }));

    await lossReasonsFrom(supabase).insert(seedRows);
  }

  const { data, error } = (await lossReasonsFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as { data: LossReasonRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar motivos de perda' };
  return { success: true, data: data ?? [] };
}

export async function addLossReason(name: string): Promise<ActionResult<LossReasonRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: 'Nome é obrigatório' };

  // Get max sort_order
  const { data: maxRow } = (await lossReasonsFrom(supabase)
    .select('sort_order')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()) as { data: { sort_order: number } | null };

  const nextOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = (await lossReasonsFrom(supabase)
    .insert({ org_id: orgId, name: trimmed, is_system: false, sort_order: nextOrder })
    .select()
    .single()) as { data: LossReasonRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao adicionar motivo' };
  revalidatePath('/settings/prospecting');
  return { success: true, data };
}

export async function updateLossReason(
  id: string,
  name: string,
): Promise<ActionResult<LossReasonRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: 'Nome é obrigatório' };

  const { data, error } = (await lossReasonsFrom(supabase)
    .update({ name: trimmed })
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single()) as { data: LossReasonRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao atualizar motivo' };
  revalidatePath('/settings/prospecting');
  return { success: true, data };
}

export async function deleteLossReason(id: string): Promise<ActionResult<{ deleted: true }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Check if it's a system reason
  const { data: reason } = (await lossReasonsFrom(supabase)
    .select('is_system')
    .eq('id', id)
    .eq('org_id', orgId)
    .single()) as { data: { is_system: boolean } | null };

  if (!reason) return { success: false, error: 'Motivo não encontrado' };
  if (reason.is_system) return { success: false, error: 'Motivos padrão não podem ser removidos' };

  const { error } = await lossReasonsFrom(supabase)
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: 'Erro ao remover motivo' };
  revalidatePath('/settings/prospecting');
  return { success: true, data: { deleted: true } };
}
