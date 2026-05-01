'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchFeedbackAnalyticsData } from '../services/feedback-analytics.service';
import type { FeedbackAnalyticsData } from '../types/feedback-analytics.types';
import { analyticsParamsSchema, getPeriodDates } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchFeedbackAnalytics(
  period: string = '30d',
  closerId?: string,
  dateRange?: { from: string; to: string },
): Promise<ActionResult<FeedbackAnalyticsData>> {
  try {
    const params = analyticsParamsSchema.safeParse({ period, dateRange });
    if (!params.success) return { success: false, error: 'Parâmetros inválidos' };

    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const { start, end } = dateRange
      ? { start: `${dateRange.from}T03:00:00Z`, end: `${dateRange.to}T23:59:59-03:00` }
      : getPeriodDates(period);

    const data = await fetchFeedbackAnalyticsData(supabase, orgId, start, end, closerId);

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
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
