'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';

import { validateToken } from '../services/threecplus.service';

interface SaveThreeCPlusInput {
  login: string;
  apiToken: string;
  domain: string;
}

export async function saveThreeCPlusConfig(
  input: SaveThreeCPlusInput,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const login = input.login.trim();
  const apiToken = input.apiToken.trim();
  // Sanitize domain: strip protocol, trailing slashes, and .3cplus.com.br suffix if pasted
  const domain = input.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.3c\.plus.*$/, '')
    .replace(/\/$/, '');

  if (!login) return { success: false, error: 'Login é obrigatório' };
  if (!apiToken) return { success: false, error: 'API Token é obrigatório' };
  if (!domain) return { success: false, error: 'Domínio é obrigatório' };

  // Validate token with a test API call
  try {
    await validateToken(domain, apiToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token inválido';
    console.error('[3cplus] Token validation failed:', message);
    return { success: false, error: `Falha ao validar token: ${message}` };
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

    if (error) {
      console.error('[3cplus] Update failed:', error.message, error.code, error.details);
      return { success: false, error: `Erro ao atualizar: ${error.message}` };
    }
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

    if (error) {
      console.error('[3cplus] Insert failed:', error.message, error.code, error.details);
      return { success: false, error: `Erro ao salvar: ${error.message}` };
    }
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
