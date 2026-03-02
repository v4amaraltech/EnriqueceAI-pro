'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchActivityAnalyticsData } from '../services/activity-analytics.service';
import type { ActivityAnalyticsData } from '../types/activity-analytics.types';
import { getPeriodDates } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchActivityAnalytics(
  period: string = '30d',
  userIds?: string[],
  dateRange?: { from: string; to: string },
): Promise<ActionResult<ActivityAnalyticsData>> {
  try {
    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const { start, end } = dateRange
      ? { start: new Date(dateRange.from).toISOString(), end: new Date(dateRange.to + 'T23:59:59').toISOString() }
      : getPeriodDates(period);

    const data = await fetchActivityAnalyticsData(
      supabase,
      orgId,
      start,
      end,
      userIds && userIds.length > 0 ? userIds : undefined,
    );

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
