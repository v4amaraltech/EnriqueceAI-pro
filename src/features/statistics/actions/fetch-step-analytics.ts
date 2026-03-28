'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchStepAnalyticsData } from '../services/step-analytics.service';
import type { CadenceStepAnalyticsData } from '../types/step-analytics';
import { analyticsParamsSchema, getPeriodDates } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchStepAnalytics(
  cadenceId: string,
  period: string = '30d',
  userIds?: string[],
  dateRange?: { from: string; to: string },
): Promise<ActionResult<CadenceStepAnalyticsData>> {
  try {
    const params = analyticsParamsSchema.safeParse({ period, userIds, cadenceId, dateRange });
    if (!params.success) return { success: false, error: 'Parâmetros inválidos' };

    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const { start, end } = dateRange
      ? { start: new Date(dateRange.from).toISOString(), end: new Date(dateRange.to + 'T23:59:59').toISOString() }
      : getPeriodDates(period);

    const data = await fetchStepAnalyticsData(
      supabase,
      orgId,
      cadenceId,
      start,
      end,
      userIds && userIds.length > 0 ? userIds : undefined,
    );

    return { success: true, data };
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so navigation works correctly
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
