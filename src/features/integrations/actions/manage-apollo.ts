'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { requireManager } from '@/lib/auth/require-manager';
import { encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function saveApolloConnection(
  apiKey: string,
): Promise<ActionResult<void>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
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
  const { data: existing } = (await from(supabase, 'apollo_connections' as never)
    .select('id')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) {
    const { error } = await from(supabase, 'apollo_connections' as never)
      .update({ api_key_encrypted: encrypted, status: 'connected' } as Record<string, unknown>)
      .eq('id', existing.id);

    const qErr = handleQueryError(error, 'Erro ao atualizar conexao Apollo', 'apollo');
    if (qErr) return qErr;
  } else {
    const { error } = await from(supabase, 'apollo_connections' as never)
      .insert({
        org_id: member.org_id,
        api_key_encrypted: encrypted,
        status: 'connected',
      } as Record<string, unknown>);

    const qErr2 = handleQueryError(error, 'Erro ao salvar conexao Apollo', 'apollo');
    if (qErr2) return qErr2;
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

export async function deleteApolloConnection(): Promise<ActionResult<void>> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organizacao nao encontrada' };
  }

  const { error } = await from(supabase, 'apollo_connections' as never)
    .delete()
    .eq('org_id', member.org_id);

  const qErr3 = handleQueryError(error, 'Erro ao desconectar Apollo', 'apollo');
  if (qErr3) return qErr3;

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

export async function fetchApolloConnection(): Promise<ActionResult<{ connected: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data } = (await from(supabase, 'apollo_connections' as never)
    .select('id, status')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { id: string; status: string } | null };

  return {
    success: true,
    data: { connected: data?.status === 'connected' },
  };
}
