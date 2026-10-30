import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type { CrmCredentials } from '@/features/integrations/types/crm';

/**
 * Responsável do card no Kommo = o closer da reunião.
 *
 * O modal de Ganho tenta pré-selecionar o usuário do Kommo casando o e-mail do
 * closer com a lista de usuários, mas essa lista chega de forma assíncrona: se
 * o SDR confirma antes dela chegar (ou se a chamada falha), `crm_options` é
 * gravado SEM `responsibleUserId` e o Kommo atribui o card ao dono do token da
 * integração (caso NEXT360 Telecom, 29–30/10/2026: card 26624607 nasceu com
 * o Vini em vez do Jhonata).
 *
 * Ordem de resolução:
 *   1. responsável explícito do modal (`crmOptions.responsibleUserId`), desde
 *      que seja diferente do padrão da conexão — os chamadores sem modal
 *      (`pushLeadToCrmWithDefaults`, `markDealWonInCrm`) repassam o padrão
 *      nesse mesmo campo, e o closer tem prioridade sobre o padrão;
 *   2. usuário do Kommo cujo e-mail bate com o do closer do lead;
 *   3. `crm_connections.default_responsible_user_id`;
 *   4. nenhum (comportamento antigo) — com `console.warn` e o leadId.
 */

export interface KommoUserLite {
  id: number;
  name: string;
  email: string;
}

export interface KommoUsersSource {
  fetchUsers(credentials: CrmCredentials): Promise<KommoUserLite[]>;
}

export interface ResolveKommoResponsibleParams {
  supabase: SupabaseClient;
  orgId: string;
  leadId: string;
  /** `leads.closer_id` (FK para `closers.id`, não é usuário do app). */
  closerId: string | null | undefined;
  /** Responsável que veio em `crmOptions` (modal ou defaults repassados). */
  explicitUserId: string | null | undefined;
  /** `crm_connections.default_responsible_user_id`. */
  connectionDefaultUserId: string | null | undefined;
  adapter: KommoUsersSource;
  credentials: CrmCredentials;
}

/** Cache curto da lista de usuários do Kommo, por org. */
const KOMMO_USERS_CACHE_TTL_MS = 5 * 60 * 1000;
const kommoUsersCache = new Map<string, { expiresAt: number; users: KommoUserLite[] }>();

/** Só para testes. */
export function clearKommoUsersCache(): void {
  kommoUsersCache.clear();
}

export async function fetchKommoUsersCached(
  orgId: string,
  adapter: KommoUsersSource,
  credentials: CrmCredentials,
  now: number = Date.now(),
): Promise<KommoUserLite[]> {
  const cached = kommoUsersCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.users;

  const users = await adapter.fetchUsers(credentials);
  kommoUsersCache.set(orgId, { expiresAt: now + KOMMO_USERS_CACHE_TTL_MS, users });
  return users;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Devolve o id (string) do usuário do Kommo que deve ficar como responsável
 * pelo card, ou `undefined` para criar o card sem responsável (como antes).
 * Nunca lança: qualquer erro ao consultar closer/usuários cai no padrão da
 * conexão e vai para o log.
 */
export async function resolveKommoResponsibleUserId(
  params: ResolveKommoResponsibleParams,
): Promise<string | undefined> {
  const { supabase, orgId, leadId, closerId, adapter, credentials } = params;
  const explicit = params.explicitUserId?.trim() || undefined;
  const connectionDefault = params.connectionDefaultUserId?.trim() || undefined;

  if (explicit && explicit !== connectionDefault) return explicit;

  if (closerId) {
    try {
      const { data: closer } = (await from(supabase, 'closers')
        .select('email')
        .eq('id', closerId)
        .eq('org_id', orgId)
        .maybeSingle()) as { data: { email: string | null } | null };

      const closerEmail = normalizeEmail(closer?.email);
      if (closerEmail) {
        const users = await fetchKommoUsersCached(orgId, adapter, credentials);
        const match = users.find((u) => normalizeEmail(u.email) === closerEmail);
        if (match) return String(match.id);
        console.warn(
          '[crm-push] closer sem usuário no Kommo lead=%s org=%s closer=%s email=%s — usando o padrão da conexão',
          leadId,
          orgId,
          closerId,
          closerEmail,
        );
      } else {
        console.warn('[crm-push] closer sem e-mail lead=%s org=%s closer=%s', leadId, orgId, closerId);
      }
    } catch (err) {
      console.warn('[crm-push] falha ao resolver responsável pelo closer lead=%s org=%s: %s', leadId, orgId, err);
    }
  }

  if (connectionDefault) return connectionDefault;

  console.warn('[crm-push] card do Kommo sem responsável lead=%s org=%s (sem closer casado nem padrão)', leadId, orgId);
  return undefined;
}
