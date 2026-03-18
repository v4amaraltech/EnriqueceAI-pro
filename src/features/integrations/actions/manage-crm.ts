'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId, getManagerOrgId } from '@/lib/auth/get-org-id';

import { encryptJson } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';

import type {
  CrmConnectionRow,
  CrmConnectionSafe,
  CrmProvider,
  CrmSyncLogRow,
  FieldMapping,
} from '../types/crm';
import { DEFAULT_FIELD_MAPPINGS } from '../types/crm';
import { CRMRegistry } from '../services/crm-registry';
import { CrmSyncService } from '../services/crm-sync.service';

function getCrmRedirectUri(provider: CrmProvider): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  // Pipedrive forces private apps to use /API/v2/callback
  if (provider === 'pipedrive') {
    return `${baseUrl}/API/v2/callback`;
  }
  return `${baseUrl}/api/auth/callback/${provider}`;
}

export async function getCrmAuthUrl(
  provider: CrmProvider,
): Promise<ActionResult<{ url: string }>> {
  try {
    await getManagerOrgId();

    if (!CRMRegistry.isSupported(provider)) {
      return { success: false, error: `Provedor CRM "${provider}" não suportado` };
    }

    const adapter = CRMRegistry.getAdapter(provider);
    const redirectUri = getCrmRedirectUri(provider);
    const url = adapter.getAuthUrl(redirectUri);

    return { success: true, data: { url } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao gerar URL de autenticação',
    };
  }
}

export async function handleCrmCallback(
  provider: CrmProvider,
  code: string,
): Promise<ActionResult<CrmConnectionSafe>> {
  try {
    const { orgId, supabase } = await getManagerOrgId();

    const adapter = CRMRegistry.getAdapter(provider);
    const redirectUri = getCrmRedirectUri(provider);
    const credentials = await adapter.exchangeCode(code, redirectUri);

    // Validate the connection works
    const valid = await adapter.validateConnection(credentials);
    if (!valid) {
      return { success: false, error: 'Não foi possível validar a conexão com o CRM' };
    }

    // Get default field mapping
    const fieldMapping = DEFAULT_FIELD_MAPPINGS[provider];

    // Upsert connection
    const { data, error } = (await from(supabase, 'crm_connections')
      .upsert(
        {
          org_id: orgId,
          crm_provider: provider,
          credentials_encrypted: encryptJson(credentials),
          field_mapping: fieldMapping,
          status: 'connected',
        } as Record<string, unknown>,
        { onConflict: 'org_id,crm_provider' },
      )
      .select('id, crm_provider, field_mapping, status, last_sync_at, created_at, updated_at')
      .single()) as { data: CrmConnectionSafe | null; error: { message: string } | null };

    if (error || !data) {
      return { success: false, error: 'Erro ao salvar conexão CRM' };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao conectar CRM',
    };
  }
}

export async function connectRdStationCrm(
  token: string,
): Promise<ActionResult<CrmConnectionSafe>> {
  try {
    const { orgId, supabase } = await getManagerOrgId();

    const adapter = CRMRegistry.getAdapter('rdstation');
    const credentials = { access_token: token, api_key: token };

    const valid = await adapter.validateConnection(credentials);
    if (!valid) {
      return { success: false, error: 'Token inválido. Verifique e tente novamente.' };
    }

    const fieldMapping = DEFAULT_FIELD_MAPPINGS.rdstation;

    const { data, error } = (await from(supabase, 'crm_connections')
      .upsert(
        {
          org_id: orgId,
          crm_provider: 'rdstation',
          credentials_encrypted: encryptJson(credentials),
          field_mapping: fieldMapping,
          status: 'connected',
        } as Record<string, unknown>,
        { onConflict: 'org_id,crm_provider' },
      )
      .select('id, crm_provider, field_mapping, status, last_sync_at, created_at, updated_at')
      .single()) as { data: CrmConnectionSafe | null; error: { message: string } | null };

    if (error || !data) {
      return { success: false, error: 'Erro ao salvar conexão RD Station CRM' };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao conectar RD Station CRM',
    };
  }
}

export async function disconnectCrm(
  provider: CrmProvider,
): Promise<ActionResult<{ disconnected: boolean }>> {
  try {
    const { orgId, supabase } = await getManagerOrgId();

    const { error } = await from(supabase, 'crm_connections')
      .delete()
      .eq('org_id', orgId)
      .eq('crm_provider', provider);

    if (error) {
      return { success: false, error: 'Erro ao desconectar CRM' };
    }

    return { success: true, data: { disconnected: true } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao desconectar CRM',
    };
  }
}

export async function updateCrmFieldMapping(
  provider: CrmProvider,
  fieldMapping: FieldMapping,
): Promise<ActionResult<CrmConnectionSafe>> {
  try {
    const { orgId, supabase } = await getManagerOrgId();

    const { data, error } = (await from(supabase, 'crm_connections')
      .update({ field_mapping: fieldMapping } as Record<string, unknown>)
      .eq('org_id', orgId)
      .eq('crm_provider', provider)
      .select('id, crm_provider, field_mapping, status, last_sync_at, created_at, updated_at')
      .single()) as { data: CrmConnectionSafe | null; error: { message: string } | null };

    if (error || !data) {
      return { success: false, error: 'Erro ao atualizar mapeamento de campos' };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao atualizar mapeamento',
    };
  }
}

export async function fetchCrmConnections(): Promise<ActionResult<CrmConnectionSafe[]>> {
  try {
    const { orgId, supabase } = await getAuthOrgId();

    const { data, error } = (await from(supabase, 'crm_connections')
      .select('id, crm_provider, field_mapping, status, last_sync_at, created_at, updated_at')
      .eq('org_id', orgId)) as { data: CrmConnectionSafe[] | null; error: { message: string } | null };

    if (error) {
      return { success: false, error: 'Erro ao buscar conexões CRM' };
    }

    return { success: true, data: data ?? [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao buscar conexões CRM',
    };
  }
}

export async function fetchCrmSyncLogs(
  provider: CrmProvider,
  limit = 10,
): Promise<ActionResult<CrmSyncLogRow[]>> {
  try {
    const { orgId, supabase } = await getAuthOrgId();

    // Get connection ID for this provider
    const { data: connection } = (await from(supabase, 'crm_connections')
      .select('id')
      .eq('org_id', orgId)
      .eq('crm_provider', provider)
      .maybeSingle()) as { data: { id: string } | null };

    if (!connection) {
      return { success: true, data: [] };
    }

    const { data, error } = (await from(supabase, 'crm_sync_log')
      .select('*')
      .eq('connection_id', connection.id)
      .order('created_at', { ascending: false })
      .limit(limit)) as { data: CrmSyncLogRow[] | null; error: { message: string } | null };

    if (error) {
      return { success: false, error: 'Erro ao buscar logs de sincronização' };
    }

    return { success: true, data: data ?? [] };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao buscar logs',
    };
  }
}

export async function triggerCrmSync(
  provider: CrmProvider,
): Promise<ActionResult<{ message: string }>> {
  try {
    const { orgId, supabase } = await getManagerOrgId();

    // Get connection
    const { data: connection } = (await from(supabase, 'crm_connections')
      .select('*')
      .eq('org_id', orgId)
      .eq('crm_provider', provider)
      .single()) as { data: CrmConnectionRow | null };

    if (!connection) {
      return { success: false, error: 'Conexão CRM não encontrada' };
    }

    if (connection.status === 'syncing') {
      return { success: false, error: 'Sincronização já em andamento' };
    }

    // Mark as syncing
    await from(supabase, 'crm_connections')
      .update({ status: 'syncing' } as Record<string, unknown>)
      .eq('id', connection.id);

    // Run sync in background (fire-and-forget from the action perspective)
    void CrmSyncService.syncConnection(connection.id).catch((err) => {
      console.error('[triggerCrmSync] Sync failed:', err);
    });

    return { success: true, data: { message: 'Sincronização iniciada' } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao iniciar sincronização',
    };
  }
}
