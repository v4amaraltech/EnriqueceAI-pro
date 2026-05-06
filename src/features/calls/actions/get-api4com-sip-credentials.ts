'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { decrypt } from '@/lib/security/encryption';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';

export interface Api4ComSipCredentials {
  sipDomain: string;
  ramal: string;
  sipPassword: string;
  apiToken: string;
}

/**
 * Returns decrypted API4COM SIP credentials for client-side webphone.
 * Uses service role to decrypt encrypted fields.
 */
export async function getApi4ComSipCredentials(): Promise<ActionResult<Api4ComSipCredentials>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.data;

  const serviceClient = createServiceRoleClient();

  const { data, error } = (await from(serviceClient, 'api4com_connections' as never)
    .select('ramal, api_key_encrypted, sip_domain, sip_password_encrypted')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as {
    data: {
      ramal: string;
      api_key_encrypted: string | null;
      sip_domain: string | null;
      sip_password_encrypted: string | null;
    } | null;
    error: unknown;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar credenciais SIP' };
  }

  if (!data) {
    return { success: false, error: 'API4COM não configurado para este usuário' };
  }

  // sip_domain is per-account (same for every SDR in the org). When the SDR
  // skipped that field but the manager filled it, inherit it instead of
  // refusing to start the webphone.
  let resolvedSipDomain = data.sip_domain;
  if (!resolvedSipDomain) {
    const { data: orgFallback } = (await from(serviceClient, 'api4com_connections' as never)
      .select('sip_domain')
      .eq('org_id', orgId)
      .not('sip_domain', 'is', null)
      .limit(1)
      .maybeSingle()) as { data: { sip_domain: string | null } | null };
    resolvedSipDomain = orgFallback?.sip_domain ?? null;
  }

  if (!resolvedSipDomain) {
    return { success: false, error: 'Domínio SIP não configurado. Peça ao gestor para preencher o Domínio SIP nas integrações da organização.' };
  }
  if (!data.sip_password_encrypted) {
    return { success: false, error: 'Senha SIP do ramal não configurada. Abra Integrações → API4COM e preencha a Senha do Ramal.' };
  }
  if (!data.api_key_encrypted) {
    return { success: false, error: 'API Token da API4COM não configurado' };
  }

  return {
    success: true,
    data: {
      sipDomain: resolvedSipDomain,
      ramal: data.ramal,
      sipPassword: decrypt(data.sip_password_encrypted),
      apiToken: decrypt(data.api_key_encrypted),
    },
  };
}
