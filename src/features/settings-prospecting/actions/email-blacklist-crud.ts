'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

export interface EmailBlacklistRow {
  id: string;
  org_id: string;
  domain: string;
  created_at: string;
}

function blacklistFrom(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return from(supabase, 'email_blacklist');
}

export async function listBlacklistDomains(): Promise<ActionResult<EmailBlacklistRow[]>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await blacklistFrom(supabase)
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })) as { data: EmailBlacklistRow[] | null; error: unknown };

  if (error) return { success: false, error: 'Erro ao listar domínios bloqueados' };
  return { success: true, data: data ?? [] };
}

export async function addBlacklistDomain(domain: string): Promise<ActionResult<EmailBlacklistRow>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return { success: false, error: 'Domínio é obrigatório' };

  // Basic domain format validation
  if (!trimmed.includes('.') || trimmed.includes(' ')) {
    return { success: false, error: 'Formato de domínio inválido' };
  }

  const { data, error } = (await blacklistFrom(supabase)
    .insert({ org_id: orgId, domain: trimmed })
    .select()
    .single()) as { data: EmailBlacklistRow | null; error: unknown };

  if (error || !data) return { success: false, error: 'Erro ao adicionar domínio (pode já estar na lista)' };
  return { success: true, data };
}

export async function deleteBlacklistDomain(id: string): Promise<ActionResult<{ deleted: true }>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await blacklistFrom(supabase)
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) return { success: false, error: 'Erro ao remover domínio' };
  return { success: true, data: { deleted: true } };
}
