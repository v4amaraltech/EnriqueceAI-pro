'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

/**
 * Estado do formulário de busca do Apollo (ApolloSearchForm). É exatamente o que
 * persistimos como preset — carregar um filtro salvo é só re-hidratar estes
 * campos no form (sem mapeamento reverso para SearchApolloInput).
 *
 * NÃO exportar: este arquivo é `'use server'`, que só pode exportar funções
 * async — exportar este objeto Zod quebrava o módulo inteiro em runtime
 * ("A 'use server' file can only export async functions, found object"),
 * derrubando salvar E buscar no Apollo. Mantém-se interno; o tipo derivado
 * (ApolloFilterState) pode ser exportado (tipos somem em runtime).
 */
const apolloFilterStateSchema = z.object({
  titles: z.string(),
  locations: z.string(),
  keywords: z.string(),
  domains: z.string(),
  emailStatuses: z.array(z.string()),
  industries: z.array(z.string()),
  employeeRanges: z.array(z.string()),
  includeSimilarTitles: z.boolean(),
});

export type ApolloFilterState = z.infer<typeof apolloFilterStateSchema>;

export interface ApolloSavedSearch {
  id: string;
  name: string;
  filters: ApolloFilterState;
}

const saveSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao filtro').max(80, 'Nome muito longo'),
  filters: apolloFilterStateSchema,
});

/**
 * Salva (ou sobrescreve, por nome) um preset de filtros do Apollo do usuário
 * logado. Escopo de org+usuário via RLS — cada SDR só mexe nos próprios.
 */
export async function saveApolloSearch(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'apollo_saved_searches')
    .upsert(
      {
        org_id: orgId,
        user_id: userId,
        name: parsed.data.name,
        filters: parsed.data.filters,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>,
      { onConflict: 'org_id,user_id,name' },
    )
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) {
    return { success: false, error: 'Erro ao salvar o filtro' };
  }
  return { success: true, data: { id: data.id } };
}

/** Lista os filtros salvos do usuário logado (mais recentes primeiro). */
export async function listApolloSearches(): Promise<ActionResult<ApolloSavedSearch[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'apollo_saved_searches')
    .select('id, name, filters')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })) as {
    data: ApolloSavedSearch[] | null;
    error: { message: string } | null;
  };

  if (error) return { success: false, error: 'Erro ao carregar filtros salvos' };
  return { success: true, data: data ?? [] };
}

/** Exclui um filtro salvo do usuário logado (escopo garantido por org+user). */
export async function deleteApolloSearch(id: string): Promise<ActionResult<void>> {
  if (!z.string().uuid().safeParse(id).success) {
    return { success: false, error: 'Filtro inválido' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = await from(supabase, 'apollo_saved_searches')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) return { success: false, error: 'Erro ao excluir o filtro' };
  return { success: true, data: undefined };
}

const renameSchema = z.object({
  id: z.string().uuid('Filtro inválido'),
  name: z.string().trim().min(1, 'Dê um nome ao filtro').max(80, 'Nome muito longo'),
});

/** Renomeia um filtro salvo do usuário logado (por id, escopado org+user). */
export async function renameApolloSearch(
  input: z.infer<typeof renameSchema>,
): Promise<ActionResult<void>> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = (await from(supabase, 'apollo_saved_searches')
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', parsed.data.id)
    .eq('org_id', orgId)
    .eq('user_id', userId)) as { error: { message: string; code?: string } | null };

  if (error) {
    // UNIQUE(org_id, user_id, name) — nome já usado por outro preset do usuário.
    if (error.code === '23505' || error.message?.includes('duplicate')) {
      return { success: false, error: 'Você já tem um filtro com esse nome' };
    }
    return { success: false, error: 'Erro ao renomear o filtro' };
  }
  return { success: true, data: undefined };
}

const updateFiltersSchema = z.object({
  id: z.string().uuid('Filtro inválido'),
  filters: apolloFilterStateSchema,
});

/** Sobrescreve os filtros de um preset com o estado atual (por id, org+user). */
export async function updateApolloSearchFilters(
  input: z.infer<typeof updateFiltersSchema>,
): Promise<ActionResult<void>> {
  const parsed = updateFiltersSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = await from(supabase, 'apollo_saved_searches')
    .update({ filters: parsed.data.filters, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', parsed.data.id)
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) return { success: false, error: 'Erro ao atualizar o filtro' };
  return { success: true, data: undefined };
}
