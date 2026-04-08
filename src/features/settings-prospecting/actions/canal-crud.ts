'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

export interface CanalOptionRow {
  id: string;
  org_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

const DEFAULT_CANALS = [
  'Facebook',
  'Google',
  'Instagram',
  'Orgânico',
  'TikTok',
  'LinkedIn',
  'Indicação',
  'Bing',
  'Prospecção Fria',
  'Outbound',
  'Landing Page Indicação',
  'Closer',
  'Lavras',
  'Planning',
  'Torres',
];

const uuidSchema = z.string().uuid('ID inválido');
const nameSchema = z.string().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo');

function canalFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return from(supabase, 'canal_options' as never);
}

/** List canal options for the current org. Seeds defaults if empty. */
export async function listCanalOptions(): Promise<ActionResult<CanalOptionRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Check if org has any canals; if not, seed defaults
  const { data: existing } = (await canalFrom(supabase)
    .select('id')
    .eq('org_id', orgId)
    .limit(1)) as { data: { id: string }[] | null };

  if (!existing || existing.length === 0) {
    const seedRows = DEFAULT_CANALS.map((name, i) => ({
      org_id: orgId,
      name,
      sort_order: i + 1,
    }));
    await canalFrom(supabase).insert(seedRows);
  }

  const { data, error } = (await canalFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })) as { data: CanalOptionRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar canais' };
  return { success: true, data: data ?? [] };
}

export async function addCanalOption(name: string): Promise<ActionResult<CanalOptionRow>> {
  const parsed = nameSchema.safeParse(name.trim());
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Nome inválido' };

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Sem permissão' };
  }

  const trimmed = parsed.data;

  const { data: maxRow } = (await canalFrom(supabase)
    .select('sort_order')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()) as { data: { sort_order: number } | null };

  const nextOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = (await canalFrom(supabase)
    .insert({ org_id: orgId, name: trimmed, sort_order: nextOrder })
    .select()
    .single()) as { data: CanalOptionRow | null; error: { message?: string; code?: string } | null };

  if (error || !data) {
    if (error?.code === '23505') return { success: false, error: 'Canal já existe' };
    return { success: false, error: 'Erro ao adicionar canal' };
  }

  revalidatePath('/settings/prospecting');
  return { success: true, data };
}

export async function updateCanalOption(id: string, name: string): Promise<ActionResult<CanalOptionRow>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: 'ID inválido' };
  const nameParsed = nameSchema.safeParse(name.trim());
  if (!nameParsed.success) return { success: false, error: nameParsed.error.errors[0]?.message ?? 'Nome inválido' };

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Sem permissão' };
  }

  const { data, error } = (await canalFrom(supabase)
    .update({ name: nameParsed.data })
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single()) as { data: CanalOptionRow | null; error: { message?: string; code?: string } | null };

  if (error || !data) {
    if (error?.code === '23505') return { success: false, error: 'Canal já existe' };
    return { success: false, error: 'Erro ao atualizar canal' };
  }

  revalidatePath('/settings/prospecting');
  return { success: true, data };
}

export async function deleteCanalOption(id: string): Promise<ActionResult<{ deleted: true }>> {
  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: 'ID inválido' };

  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Sem permissão' };
  }

  const { error } = await canalFrom(supabase)
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: 'Erro ao remover canal' };
  revalidatePath('/settings/prospecting');
  return { success: true, data: { deleted: true } };
}
