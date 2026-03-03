'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId, getManagerOrgId } from '@/lib/auth/get-org-id';

import { encryptJson } from '@/lib/security/encryption';

import type {
  CrmConnectionRow,
  CrmConnectionSafe,
  CrmProvider,
  CrmSyncLogRow,
  FieldMapping,
} from '../types/crm';
import { DEFAULT_FIELD_MAPPINGS } from '../types/crm';
import { CRMRegistry } from '../services/crm-registry';

function getCrmRedirectUri(provider: CrmProvider): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
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
    const { data, error } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
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

export async function disconnectCrm(
  provider: CrmProvider,
): Promise<ActionResult<{ disconnected: boolean }>> {
  try {
    const { orgId, supabase } = await getManagerOrgId();

    const { error } = await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
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

    const { data, error } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
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

    const { data, error } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
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
    const { data: connection } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
      .select('id')
      .eq('org_id', orgId)
      .eq('crm_provider', provider)
      .maybeSingle()) as { data: { id: string } | null };

    if (!connection) {
      return { success: true, data: [] };
    }

    const { data, error } = (await (supabase
      .from('crm_sync_log') as ReturnType<typeof supabase.from>)
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
    const { data: connection } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
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
    await (supabase.from('crm_connections') as ReturnType<typeof supabase.from>)
      .update({ status: 'syncing' } as Record<string, unknown>)
      .eq('id', connection.id);

    // Run sync in background (fire-and-forget from the action perspective)
    // The actual sync is handled by the API route /api/crm/sync
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    fetch(`${appUrl}/api/crm/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: connection.id }),
    }).catch(() => {
      // Fire-and-forget — errors will be logged in sync_log
    });

    return { success: true, data: { message: 'Sincronização iniciada' } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao iniciar sincronização',
    };
  }
}
