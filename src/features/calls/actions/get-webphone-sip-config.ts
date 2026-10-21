'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export type WebphoneSipConfig =
  | { enabled: false; reason: 'no_connection' | 'not_enabled' | 'missing_sip' }
  | { enabled: true; sipDomain: string; ramal: string; sipPassword: string };

/**
 * Credenciais SIP do PRÓPRIO usuário para o webphone no navegador. Só o
 * mínimo que o registro SIP precisa (domínio, ramal, senha do ramal) — nunca o
 * token da API. Só devolve algo quando o gestor ligou o webphone para a pessoa
 * (`webphone_enabled`), para o rollout ser um SDR por vez.
 *
 * Substitui `getApi4ComSipCredentials` (removida no bloco 2), que devolvia
 * também o token da API ao cliente e não tinha chamadores.
 */
export async function getWebphoneSipConfig(): Promise<ActionResult<WebphoneSipConfig>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.data;

  const client = createServiceRoleClient();
  const { data, error } = (await from(client, 'api4com_connections' as never)
    .select('ramal, sip_domain, sip_password_encrypted, webphone_enabled, status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as {
    data: {
      ramal: string;
      sip_domain: string | null;
      sip_password_encrypted: string | null;
      webphone_enabled: boolean | null;
      status: string;
    } | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[webphone] getWebphoneSipConfig failed:', error.message);
    return { success: false, error: 'Erro ao buscar a configuração do webphone' };
  }

  if (!data || data.status !== 'connected') return { success: true, data: { enabled: false, reason: 'no_connection' } };
  if (!data.webphone_enabled) return { success: true, data: { enabled: false, reason: 'not_enabled' } };
  if (!data.sip_domain || !data.sip_password_encrypted || !data.ramal) {
    return { success: true, data: { enabled: false, reason: 'missing_sip' } };
  }

  return {
    success: true,
    data: {
      enabled: true,
      sipDomain: data.sip_domain.trim().toLowerCase(),
      ramal: data.ramal,
      sipPassword: decrypt(data.sip_password_encrypted),
    },
  };
}
