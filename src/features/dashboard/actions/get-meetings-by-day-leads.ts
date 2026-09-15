'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { fetchMeetingsByDayLeads } from '../services/meetings-by-day-leads.service';
import type { DashboardFilters, MeetingsByDayLeads } from '../types';

const inputSchema = z.object({
  filters: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM format'),
    cadenceIds: z.array(z.string().uuid()).default([]),
    userIds: z.array(z.string().uuid()).default([]),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
  day: z.number().int().min(1).max(31),
});

export interface GetMeetingsByDayLeadsInput {
  filters: DashboardFilters;
  day: number;
}

/**
 * Leads de uma barra do gráfico "RM e RR por dia". Recebe os MESMOS filtros da
 * página (mês, cadências, vendedores, dateFrom/dateTo) pra cair no mesmo universo
 * dos cards. Dashboard é global para todos os papéis (mesma regra das demais
 * actions do dashboard).
 */
export async function getMeetingsByDayLeads(
  raw: GetMeetingsByDayLeadsInput,
): Promise<ActionResult<MeetingsByDayLeads>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = createServiceRoleClient();

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Parâmetros inválidos' };
  }

  try {
    const data = await fetchMeetingsByDayLeads(supabase, orgId, parsed.data.filters, parsed.data.day);
    return { success: true, data };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    console.error('[dashboard] getMeetingsByDayLeads failed:', error);
    return { success: false, error: 'Erro ao buscar os leads do dia' };
  }
}
