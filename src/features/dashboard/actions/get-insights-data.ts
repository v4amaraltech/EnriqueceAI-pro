'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchInsightsData } from '../services/insights-metrics.service';
import type { DashboardFilters, InsightsData } from '../types';

const filtersSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM format'),
  cadenceIds: z.array(z.string().uuid()).default([]),
  userIds: z.array(z.string().uuid()).default([]),
});

export async function getInsightsData(
  rawFilters: DashboardFilters,
): Promise<ActionResult<InsightsData>> {
  const { userId, orgId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const parsed = filtersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }

  const filters = parsed.data;

  // SDR isolation: force insights to show only their own data
  if (role === 'sdr') {
    filters.userIds = [userId];
  }

  try {
    const insights = await fetchInsightsData(supabase, orgId, filters);
    return { success: true, data: insights };
  } catch {
    return { success: false, error: 'Erro ao buscar dados de insights' };
  }
}
