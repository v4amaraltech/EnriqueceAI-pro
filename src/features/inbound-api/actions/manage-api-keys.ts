'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { logAudit } from '@/lib/audit/audit-log';
import { getAuthOrgIdResult, getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { ApiKeySafe } from '../types';
import { createApiKeySchema } from '../schemas/inbound-lead.schemas';
import { generateApiKey } from '../services/api-key.service';

export async function createApiKeyAction(
  rawData: Record<string, unknown>,
): Promise<ActionResult<{ key: string; id: string; prefix: string }>> {
  const parsed = createApiKeySchema.safeParse(rawData);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  let orgId: string;
  let userId: string;
  let supabase: Awaited<ReturnType<typeof getManagerOrgId>>['supabase'];
  try {
    ({ orgId, userId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }
  const { key, hash, prefix } = generateApiKey();

  const { error } = await from(supabase, 'api_keys').insert({
    org_id: orgId,
    name: parsed.data.name,
    key_hash: hash,
    key_prefix: prefix,
    created_by: userId,
    expires_at: parsed.data.expires_at || null,
  } as Record<string, unknown>);

  if (error) {
    return { success: false, error: 'Erro ao criar chave de API' };
  }

  logAudit({ orgId, userId, action: 'api_key.created', resourceType: 'api_key', metadata: { name: parsed.data.name, prefix } });
  revalidatePath('/settings/integrations/api');

  return { success: true, data: { key, id: hash, prefix } };
}

export async function listApiKeysAction(): Promise<ActionResult<ApiKeySafe[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = await from(supabase, 'api_keys')
    .select('id, name, key_prefix, scopes, is_active, last_used_at, expires_at, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false }) as { data: ApiKeySafe[] | null; error: unknown };

  if (error) {
    return { success: false, error: 'Erro ao listar chaves' };
  }

  return { success: true, data: data ?? [] };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeApiKeyAction(keyId: string): Promise<ActionResult<void>> {
  if (!UUID_RE.test(keyId)) return { success: false, error: 'ID inválido' };
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof getManagerOrgId>>['supabase'];
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await from(supabase, 'api_keys')
    .update({ is_active: false } as Record<string, unknown>)
    .eq('id', keyId)
    .eq('org_id', orgId);

  if (error) {
    return { success: false, error: 'Erro ao revogar chave' };
  }

  logAudit({ orgId, action: 'api_key.revoked', resourceType: 'api_key', resourceId: keyId });
  revalidatePath('/settings/integrations/api');
  return { success: true, data: undefined };
}

export async function deleteApiKeyAction(keyId: string): Promise<ActionResult<void>> {
  if (!UUID_RE.test(keyId)) return { success: false, error: 'ID inválido' };
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof getManagerOrgId>>['supabase'];
  try {
    ({ orgId, supabase } = await getManagerOrgId());
  } catch {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { error } = await from(supabase, 'api_keys')
    .delete()
    .eq('id', keyId)
    .eq('org_id', orgId);

  if (error) {
    return { success: false, error: 'Erro ao excluir chave' };
  }

  revalidatePath('/settings/integrations/api');
  return { success: true, data: undefined };
}
