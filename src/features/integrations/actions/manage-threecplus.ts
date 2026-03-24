'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';

import { authenticate } from '../services/threecplus.service';

interface SaveThreeCPlusInput {
  login: string;
  password: string;
  domain: string;
}

export async function saveThreeCPlusConfig(
  input: SaveThreeCPlusInput,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const login = input.login.trim();
  const password = input.password.trim();
  const domain = input.domain.trim().toLowerCase();

  if (!login) return { success: false, error: 'Login é obrigatório' };
  if (!password) return { success: false, error: 'Senha é obrigatória' };
  if (!domain) return { success: false, error: 'Domínio é obrigatório' };

  // Authenticate to get API token
  let apiToken: string;
  try {
    const authResult = await authenticate(domain, login, password);
    apiToken = authResult.token;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha na autenticação';
    console.error('[3cplus] Authentication failed:', message);
    return { success: false, error: 'Falha na autenticação com o 3CPlus. Verifique suas credenciais e domínio.' };
  }

  // Check for existing connection
  const { data: existing } = (await from(supabase, 'threecplus_connections' as never)
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) {
    const { error } = await from(supabase, 'threecplus_connections' as never)
      .update({
        login,
        domain,
        api_token_encrypted: encrypt(apiToken),
        status: 'connected',
      } as Record<string, unknown>)
      .eq('id', existing.id);

    if (error) return { success: false, error: 'Erro ao atualizar configurações' };
  } else {
    const { error } = await from(supabase, 'threecplus_connections' as never)
      .insert({
        org_id: orgId,
        user_id: userId,
        login,
        domain,
        api_token_encrypted: encrypt(apiToken),
        status: 'connected',
      } as Record<string, unknown>);

    if (error) return { success: false, error: 'Erro ao salvar configurações' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

export async function disconnectThreeCPlus(): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = await from(supabase, 'threecplus_connections' as never)
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) return { success: false, error: 'Erro ao desconectar 3CPlus' };

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}
