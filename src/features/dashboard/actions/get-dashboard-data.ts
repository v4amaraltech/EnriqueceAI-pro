'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServiceRoleClient } from '@/lib/supabase/service';

import {
  fetchAvailableCadences,
  fetchOpportunityKpi,
} from '../services/dashboard-metrics.service';
import type { DashboardData, DashboardFilters } from '../types';

const filtersSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM format'),
  cadenceIds: z.array(z.string().uuid()).default([]),
  userIds: z.array(z.string().uuid()).default([]),
});

export async function getDashboardData(
  rawFilters: DashboardFilters,
): Promise<ActionResult<DashboardData>> {
  const { userId, orgId, role } = await requireAuthWithMember();
  // Use service role to bypass RLS — dashboard shows org-wide metrics for all roles
  const supabase = createServiceRoleClient();

  // Validate filters
  const parsed = filtersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }

  const filters = parsed.data;

  // Dashboard shows global data for all roles to foster team competition

  try {
    const [kpi, availableCadences] = await Promise.all([
      fetchOpportunityKpi(supabase, orgId, filters),
      fetchAvailableCadences(supabase, orgId),
    ]);

    return {
      success: true,
      data: { kpi, availableCadences },
    };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: 'Erro ao buscar dados do dashboard' };
  }
}
