'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';
import type { LeadForVariables } from '../utils/build-template-variables';

export interface PreviewLead extends LeadForVariables {
  id: string;
  email: string | null;
}

interface LeadRow {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  porte: string | null;
  first_name: string | null;
  endereco: { cidade?: string; uf?: string } | null;
  socios: { nome?: string }[] | null;
}

export async function fetchLeadsForPreview(
  search?: string,
  limit = 20,
): Promise<ActionResult<PreviewLead[]>> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { supabase } = auth.data;

    let query = from(supabase, 'leads')
      .select('id, razao_social, nome_fantasia, cnpj, email, telefone, porte, first_name, endereco, socios')
      .is('deleted_at', null)
      .neq('status', 'archived')
      .order('nome_fantasia', { ascending: true })
      .limit(limit);

    if (search?.trim()) {
      const term = `%${sanitizeFilterValue(search.trim())}%`;
      query = query.or(`nome_fantasia.ilike.${term},razao_social.ilike.${term},cnpj.ilike.${term}`);
    }

    const { data, error } = (await query) as {
      data: LeadRow[] | null;
      error: { message: string } | null;
    };

    if (error) return { success: false, error: error.message };

    const leads: PreviewLead[] = (data ?? []).map((row) => {
      const socios = row.socios as { nome?: string }[] | null;
      const primeiroSocio = socios?.[0]?.nome;
      // Canonical source is the lead's own `first_name` (populated on inbound
      // imports and by the auto-decisor trigger); fall back to the primary
      // sócio's name only when first_name is absent. Mirrors the activity queue
      // (fetch-pending-activities) so preview and real send agree.
      const firstName = row.first_name?.trim() || null;
      const primeiroNome =
        firstName ?? (primeiroSocio ? primeiroSocio.trim().split(/\s+/)[0] ?? null : null);
      const endereco = row.endereco as { cidade?: string; uf?: string } | null;

      return {
        id: row.id,
        razao_social: row.razao_social,
        nome_fantasia: row.nome_fantasia,
        cnpj: row.cnpj,
        email: row.email,
        telefone: row.telefone,
        porte: row.porte,
        municipio: endereco?.cidade ?? null,
        uf: endereco?.uf ?? null,
        primeiro_nome: primeiroNome,
      };
    });

    return { success: true, data: leads };
  } catch {
    return { success: false, error: 'Falha ao buscar leads para preview' };
  }
}
