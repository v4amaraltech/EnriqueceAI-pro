'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
  const supabase = await createServerSupabaseClient();

  // Validate filters
  const parsed = filtersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }

  const filters = parsed.data;

  // SDR isolation: force dashboard to show only their own data
  if (role === 'sdr') {
    filters.userIds = [userId];
  }

  try {
    const [kpi, availableCadences] = await Promise.all([
      fetchOpportunityKpi(supabase, orgId, filters),
      fetchAvailableCadences(supabase, orgId),
    ]);

    return {
      success: true,
      data: { kpi, availableCadences },
    };
  } catch {
    return { success: false, error: 'Erro ao buscar dados do dashboard' };
  }
}
