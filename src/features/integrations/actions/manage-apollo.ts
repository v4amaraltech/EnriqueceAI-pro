'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { requireManager } from '@/lib/auth/require-manager';
import { encrypt } from '@/lib/security/encryption';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function saveApolloConnection(
  apiKey: string,
): Promise<ActionResult<void>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organizacao nao encontrada' };
  }

  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { success: false, error: 'API Key e obrigatoria' };
  }

  const encrypted = encrypt(trimmed);

  // Upsert: check if exists first
  const { data: existing } = (await (supabase
    .from('apollo_connections' as never) as ReturnType<typeof supabase.from>)
    .select('id')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) {
    const { error } = await (supabase
      .from('apollo_connections' as never) as ReturnType<typeof supabase.from>)
      .update({ api_key_encrypted: encrypted, status: 'connected' } as Record<string, unknown>)
      .eq('id', existing.id);

    if (error) {
      return { success: false, error: 'Erro ao atualizar conexao Apollo' };
    }
  } else {
    const { error } = await (supabase
      .from('apollo_connections' as never) as ReturnType<typeof supabase.from>)
      .insert({
        org_id: member.org_id,
        api_key_encrypted: encrypted,
        status: 'connected',
      } as Record<string, unknown>);

    if (error) {
      return { success: false, error: 'Erro ao salvar conexao Apollo' };
    }
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

export async function deleteApolloConnection(): Promise<ActionResult<void>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organizacao nao encontrada' };
  }

  const { error } = await (supabase
    .from('apollo_connections' as never) as ReturnType<typeof supabase.from>)
    .delete()
    .eq('org_id', member.org_id);

  if (error) {
    return { success: false, error: 'Erro ao desconectar Apollo' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

export async function fetchApolloConnection(): Promise<ActionResult<{ connected: boolean }>> {
  await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organizacao nao encontrada' };
  }

  const { data } = (await (supabase
    .from('apollo_connections' as never) as ReturnType<typeof supabase.from>)
    .select('id, status')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: { id: string; status: string } | null };

  return {
    success: true,
    data: { connected: data?.status === 'connected' },
  };
}
