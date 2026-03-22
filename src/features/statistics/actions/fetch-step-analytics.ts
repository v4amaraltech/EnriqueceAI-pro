'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchStepAnalyticsData } from '../services/step-analytics.service';
import type { CadenceStepAnalyticsData } from '../types/step-analytics';
import { getPeriodDates } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchStepAnalytics(
  cadenceId: string,
  period: string = '30d',
  userIds?: string[],
  dateRange?: { from: string; to: string },
): Promise<ActionResult<CadenceStepAnalyticsData>> {
  try {
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
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
