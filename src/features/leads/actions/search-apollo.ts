'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { getEnv } from '@/config/env';

import { searchPeople, type ApolloSearchPerson } from '../services/apollo.service';
import { getApolloApiKey } from '../services/apollo-key.service';

const searchSchema = z.object({
  personTitles: z.array(z.string()).optional(),
  personLocations: z.array(z.string()).optional(),
  organizationLocations: z.array(z.string()).optional(),
  organizationKeywords: z.array(z.string()).optional(),
  organizationDomains: z.array(z.string()).optional(),
  employeeRanges: z.array(z.string()).optional(),
  personSeniorities: z.array(z.string()).optional(),
  contactEmailStatus: z.array(z.string()).optional(),
  technologyUids: z.array(z.string()).optional(),
  organizationIndustryTagIds: z.array(z.string()).optional(),
  revenueRange: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  includeSimilarTitles: z.boolean().optional(),
  qKeywords: z.string().optional(),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(25),
});

export type SearchApolloInput = z.infer<typeof searchSchema>;

export interface SearchApolloResult {
  people: ApolloSearchPerson[];
  total: number;
  page: number;
}

export async function searchApollo(input: SearchApolloInput): Promise<ActionResult<SearchApolloResult>> {
  const { orgId } = await requireAuthWithMember();

  // Use org-level key only (no global fallback for multi-tenant isolation)
  const apiKey = await getApolloApiKey(orgId);
  if (!apiKey) {
    return { success: false, error: 'Apollo não conectado. Configure em Settings > Integrações.' };
  }

  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Parâmetros de busca inválidos' };
  }

  const params = parsed.data;

  // At least one filter must be provided
  const hasFilter =
    (params.personTitles?.length ?? 0) > 0 ||
    (params.personLocations?.length ?? 0) > 0 ||
    (params.organizationLocations?.length ?? 0) > 0 ||
    (params.organizationKeywords?.length ?? 0) > 0 ||
    (params.organizationDomains?.length ?? 0) > 0 ||
    (params.employeeRanges?.length ?? 0) > 0 ||
    (params.personSeniorities?.length ?? 0) > 0 ||
    (params.contactEmailStatus?.length ?? 0) > 0 ||
    (params.technologyUids?.length ?? 0) > 0 ||
    (params.organizationIndustryTagIds?.length ?? 0) > 0 ||
    !!params.revenueRange ||
    !!params.qKeywords;

  if (!hasFilter) {
    return { success: false, error: 'Preencha pelo menos um filtro de busca' };
  }

  try {
    const result = await searchPeople(apiKey, params);
    return {
      success: true,
      data: {
        people: result.people,
        total: result.totalEntries,
        page: result.page,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar no Apollo';
    console.error('[search-apollo]', message);
    return { success: false, error: message };
  }
}
