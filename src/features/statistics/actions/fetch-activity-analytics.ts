'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchActivityAnalyticsData } from '../services/activity-analytics.service';
import type { ActivityAnalyticsData } from '../types/activity-analytics.types';
import { analyticsParamsSchema, getPeriodDates } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchActivityAnalytics(
  period: string = '30d',
  userIds?: string[],
  dateRange?: { from: string; to: string },
): Promise<ActionResult<ActivityAnalyticsData>> {
  try {
    const params = analyticsParamsSchema.safeParse({ period, userIds, dateRange });
    if (!params.success) return { success: false, error: 'Parâmetros inválidos' };

    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const { start, end } = dateRange
      ? { start: `${dateRange.from}T03:00:00Z`, end: `${dateRange.to}T23:59:59-03:00` }
      : getPeriodDates(period);

    const data = await fetchActivityAnalyticsData(
      supabase,
      orgId,
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
