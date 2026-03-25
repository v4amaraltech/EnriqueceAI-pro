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

  if (!data.sip_domain || !data.sip_password_encrypted) {
    return { success: false, error: 'Credenciais SIP do webphone não configuradas. Configure o Domínio SIP e a Senha do Ramal nas integrações.' };
  }

  if (!data.api_key_encrypted) {
    return { success: false, error: 'API Token da API4COM não configurado' };
  }

  return {
    success: true,
    data: {
      sipDomain: data.sip_domain,
      ramal: data.ramal,
      sipPassword: decrypt(data.sip_password_encrypted),
      apiToken: decrypt(data.api_key_encrypted),
    },
  };
}
