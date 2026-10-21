'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  normalizeRamal,
  pickAccountDomain,
  planExtensionSync,
  type Api4ComExtension,
} from '../services/api4com-extension-sync';
import {
  API4COM_DEFAULT_BASE_URL,
  ensureCallWebhookWithCredentials,
  getOrgSettingsCredentials,
  listExtensions,
  normalizeBaseUrl,
  type Api4ComApiCredentials,
} from '../services/api4com.service';
import type { Api4ComOrgOverview, Api4ComSyncReport, Api4ComTeamMember } from '../types';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

interface MemberRow {
  user_id: string;
  role: 'manager' | 'sdr';
}

interface ConnectionRow {
  user_id: string;
  ramal: string;
  sip_password_encrypted: string | null;
  api_key_encrypted: string | null;
  synced_at: string | null;
}

async function requireManagerOrg(): Promise<ActionResult<{ orgId: string; userId: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  if (auth.data.role !== 'manager') {
    return { success: false, error: 'Apenas gestores podem configurar a API4COM da organização' };
  }
  return { success: true, data: { orgId: auth.data.orgId, userId: auth.data.userId } };
}

async function loadMembers(client: ServiceClient, orgId: string): Promise<MemberRow[]> {
  const { data } = (await from(client, 'organization_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: MemberRow[] | null };
  return data ?? [];
}

async function loadConnections(client: ServiceClient, orgId: string): Promise<ConnectionRow[]> {
  const { data } = (await from(client, 'api4com_connections' as never)
    .select('user_id, ramal, sip_password_encrypted, api_key_encrypted, synced_at')
    .eq('org_id', orgId)) as { data: ConnectionRow[] | null };
  return data ?? [];
}

/**
 * Aplica o plano de sincronização: completa as linhas existentes (casadas pelo
 * ramal) e cria linhas para quem casou pelo e-mail. Nunca troca o ramal de uma
 * linha existente.
 */
async function applyExtensionSync(
  client: ServiceClient,
  orgId: string,
  creds: Api4ComApiCredentials,
  extensions: Api4ComExtension[],
): Promise<Api4ComSyncReport> {
  const [members, connections] = await Promise.all([loadMembers(client, orgId), loadConnections(client, orgId)]);
  const profiles = await resolveUserProfiles(members.map((m) => m.user_id));

  const plan = planExtensionSync(
    extensions,
    members.map((m) => ({ userId: m.user_id, email: profiles.get(m.user_id)?.email ?? null })),
    connections.map((c) => ({ userId: c.user_id, ramal: c.ramal })),
  );

  const person = (userId: string) => {
    const p = profiles.get(userId);
    return { name: p?.displayName ?? userId.slice(0, 8), email: p?.email ?? null };
  };
  const now = new Date().toISOString();
  const domain = pickAccountDomain(extensions);
  const errors: string[] = [];

  for (const item of plan.keep) {
    const patch: Record<string, unknown> = {
      sip_domain: item.extension.domain?.trim().toLowerCase() || domain,
      api4com_extension_id: String(item.extension.id),
      synced_at: now,
      status: 'connected',
    };
    if (item.extension.senha) patch.sip_password_encrypted = encrypt(String(item.extension.senha));
    const { error } = await from(client, 'api4com_connections' as never)
      .update(patch)
      .eq('org_id', orgId)
      .eq('user_id', item.userId);
    if (error) errors.push(`${item.ramal}: ${error.message}`);
  }

  for (const item of plan.create) {
    const row: Record<string, unknown> = {
      org_id: orgId,
      user_id: item.userId,
      ramal: normalizeRamal(item.extension.ramal),
      base_url: `${creds.baseUrl}/`,
      api_key_encrypted: null,
      sip_domain: item.extension.domain?.trim().toLowerCase() || domain,
      sip_password_encrypted: item.extension.senha ? encrypt(String(item.extension.senha)) : null,
      api4com_extension_id: String(item.extension.id),
      synced_at: now,
      status: 'connected',
    };
    const { error } = await from(client, 'api4com_connections' as never).insert(row);
    if (error) errors.push(`${row.ramal}: ${error.message}`);
  }

  await from(client, 'api4com_org_settings' as never)
    .update({ last_synced_at: now, sip_domain: domain })
    .eq('org_id', orgId);

  if (errors.length > 0) {
    console.error('[api4com] extension sync errors:', errors);
  }

  return {
    linked: plan.keep.map((k) => ({ ...person(k.userId), ramal: k.ramal })),
    created: plan.create.map((c) => ({ ...person(c.userId), ramal: normalizeRamal(c.extension.ramal) })),
    missing: plan.missing.map((m) => ({ ...person(m.userId), ramal: m.ramal })),
    ambiguous: plan.ambiguous.map((a) => ({ ...person(a.userId), ramais: a.ramais })),
    unmatched: plan.unmatched.map((u) => person(u.userId)),
  };
}

interface SaveOrgSettingsInput {
  apiToken: string;
  baseUrl?: string;
}

/**
 * Gestor cadastra o token da conta API4COM (criado com `ttl: -1`). Valida o
 * token listando os ramais, garante o webhook de eventos e sincroniza os
 * ramais do time na sequência.
 */
export async function saveApi4ComOrgSettings(
  input: SaveOrgSettingsInput,
): Promise<ActionResult<Api4ComSyncReport>> {
  const auth = await requireManagerOrg();
  if (!auth.success) return auth;
  const { orgId } = auth.data;

  const apiKey = input.apiToken?.trim();
  if (!apiKey) return { success: false, error: 'Informe o token da API4COM' };

  const creds: Api4ComApiCredentials = { apiKey, baseUrl: normalizeBaseUrl(input.baseUrl) };

  let extensions: Api4ComExtension[];
  try {
    extensions = await listExtensions(creds);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token inválido';
    return { success: false, error: `Não foi possível validar o token na API4COM: ${message}` };
  }

  const client = createServiceRoleClient();
  const { error } = await from(client, 'api4com_org_settings' as never).upsert(
    {
      org_id: orgId,
      api_key_encrypted: encrypt(apiKey),
      base_url: `${creds.baseUrl}/`,
      sip_domain: pickAccountDomain(extensions),
    },
    { onConflict: 'org_id' },
  );
  if (error) {
    console.error('[api4com] save org settings failed:', error);
    return { success: false, error: 'Erro ao salvar o token da organização' };
  }

  // Entrega de eventos (best-effort: a sincronização não depende disso).
  try {
    await ensureCallWebhookWithCredentials(creds);
  } catch (err) {
    console.warn('[api4com] ensureCallWebhook (org) failed:', err);
  }

  const report = await applyExtensionSync(client, orgId, creds, extensions);
  revalidatePath('/settings/integrations');
  return { success: true, data: report };
}

/** Re-sincroniza os ramais com o token já cadastrado. */
export async function syncApi4ComExtensions(): Promise<ActionResult<Api4ComSyncReport>> {
  const auth = await requireManagerOrg();
  if (!auth.success) return auth;
  const { orgId } = auth.data;

  const client = createServiceRoleClient();
  const creds = await getOrgSettingsCredentials(orgId, client);
  if (!creds) {
    return { success: false, error: 'Cadastre o token da API4COM da organização antes de sincronizar' };
  }

  let extensions: Api4ComExtension[];
  try {
    extensions = await listExtensions(creds);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    return { success: false, error: `Falha ao listar ramais na API4COM: ${message}` };
  }

  const report = await applyExtensionSync(client, orgId, creds, extensions);
  revalidatePath('/settings/integrations');
  return { success: true, data: report };
}

/** Remove o token da organização. As linhas de ramal ficam (voltam ao token legado, se houver). */
export async function disconnectApi4ComOrg(): Promise<ActionResult<void>> {
  const auth = await requireManagerOrg();
  if (!auth.success) return auth;

  const client = createServiceRoleClient();
  const { error } = await from(client, 'api4com_org_settings' as never).delete().eq('org_id', auth.data.orgId);
  if (error) {
    console.error('[api4com] disconnect org failed:', error);
    return { success: false, error: 'Erro ao remover o token da organização' };
  }

  revalidatePath('/settings/integrations');
  return { success: true, data: undefined };
}

/** Visão do gestor: token da org + ramal de cada pessoa do time. */
export async function fetchApi4ComOrgOverview(): Promise<ActionResult<Api4ComOrgOverview>> {
  const auth = await requireManagerOrg();
  if (!auth.success) return auth;
  const { orgId } = auth.data;

  const client = createServiceRoleClient();
  const [{ data: settings }, members, connections] = await Promise.all([
    from(client, 'api4com_org_settings' as never)
      .select('base_url, sip_domain, last_synced_at')
      .eq('org_id', orgId)
      .maybeSingle() as unknown as Promise<{
      data: { base_url: string | null; sip_domain: string | null; last_synced_at: string | null } | null;
    }>,
    loadMembers(client, orgId),
    loadConnections(client, orgId),
  ]);
  const profiles = await resolveUserProfiles(members.map((m) => m.user_id));
  const byUser = new Map(connections.map((c) => [c.user_id, c]));

  const team: Api4ComTeamMember[] = members
    .map((m) => {
      const p = profiles.get(m.user_id);
      const c = byUser.get(m.user_id);
      return {
        userId: m.user_id,
        name: p?.displayName ?? m.user_id.slice(0, 8),
        email: p?.email ?? null,
        role: m.role,
        ramal: c?.ramal ?? null,
        hasSipPassword: !!c?.sip_password_encrypted,
        syncedAt: c?.synced_at ?? null,
        hasOwnToken: !!c?.api_key_encrypted,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    success: true,
    data: {
      settings: {
        configured: !!settings,
        base_url: settings?.base_url ?? (settings ? API4COM_DEFAULT_BASE_URL : null),
        sip_domain: settings?.sip_domain ?? null,
        last_synced_at: settings?.last_synced_at ?? null,
      },
      team,
    },
  };
}
