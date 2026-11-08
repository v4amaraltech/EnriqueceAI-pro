import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

/**
 * Uma org só é "descartável" quando é a org solo criada no cadastro e ainda
 * está vazia: o próprio usuário é o dono e único membro ativo, e não há leads
 * nem cadências. Qualquer outra org (com dados ou com time) nunca é apagada
 * por fluxo de convite.
 *
 * Só deve ser chamada a partir de uma ação executada pelo PRÓPRIO usuário
 * dono (aceite autenticado do convite). Nunca por um terceiro.
 */
export async function isDisposableSoloOrg(
  client: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data: org } = (await from(client, 'organizations')
    .select('owner_id')
    .eq('id', orgId)
    .maybeSingle()) as { data: { owner_id: string } | null };
  if (!org || org.owner_id !== userId) return false;

  const { count: members } = (await from(client, 'organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'active')) as { count: number | null };
  if ((members ?? 0) > 1) return false;

  for (const table of ['leads', 'cadences']) {
    const { count, error } = (await from(client, table)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)) as { count: number | null; error?: unknown };
    // Em caso de dúvida (erro na contagem) trata como NÃO descartável.
    if (error || (count ?? 0) > 0) return false;
  }
  return true;
}
