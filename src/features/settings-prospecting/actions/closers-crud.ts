'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { logAudit } from '@/lib/audit/audit-log';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

export interface CloserRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string | null;
  created_at: string;
}

function closersFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return from(supabase, 'closers');
}

/** List all active closers for the org — available to all members (SDRs need this). */
export async function listClosers(): Promise<ActionResult<CloserRow[]>> {
  const authResult = await getAuthOrgIdResult();
  if (!authResult.success) return authResult;
  const { orgId, supabase } = authResult.data;

  const { data, error } = (await closersFrom(supabase)
    .select('id, org_id, name, email, phone, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('name', { ascending: true })) as { data: CloserRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar closers' };
  return { success: true, data: data ?? [] };
}

/** Add a new closer — manager only. */
export async function addCloser(name: string, email: string, phone?: string): Promise<ActionResult<CloserRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Acesso restrito a gestores' };
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedName) return { success: false, error: 'Nome é obrigatório' };
  if (!trimmedEmail) return { success: false, error: 'Email é obrigatório' };

  const trimmedPhone = phone?.replace(/\D/g, '').trim() || null;

  const { data, error } = (await closersFrom(supabase)
    .insert({ org_id: orgId, name: trimmedName, email: trimmedEmail, phone: trimmedPhone })
    .select('id, org_id, name, email, phone, created_at')
    .single()) as { data: CloserRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao adicionar closer' };
  logAudit({ orgId, action: 'closer.created', resourceType: 'closer', resourceId: data.id, metadata: { name: trimmedName, email: trimmedEmail } });
  revalidatePath('/settings/prospecting');
  return { success: true, data };
}

/** Update an existing closer — manager only. */
export async function updateCloser(
  id: string,
  name: string,
  email: string,
  phone?: string,
): Promise<ActionResult<CloserRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Acesso restrito a gestores' };
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedName) return { success: false, error: 'Nome é obrigatório' };
  if (!trimmedEmail) return { success: false, error: 'Email é obrigatório' };

  const trimmedPhone = phone?.replace(/\D/g, '').trim() || null;

  const { data, error } = (await closersFrom(supabase)
    .update({ name: trimmedName, email: trimmedEmail, phone: trimmedPhone })
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id, org_id, name, email, phone, created_at')
    .single()) as { data: CloserRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao atualizar closer' };
  revalidatePath('/settings/prospecting');
  return { success: true, data };
}

/** Soft-delete a closer — manager only. */
export async function deleteCloser(id: string): Promise<ActionResult<{ deleted: true }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Acesso restrito a gestores' };
  }

  const { error } = await closersFrom(supabase)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: 'Erro ao remover closer' };
  logAudit({ orgId, action: 'closer.deleted', resourceType: 'closer', resourceId: id });
  revalidatePath('/settings/prospecting');
  return { success: true, data: { deleted: true } };
}
