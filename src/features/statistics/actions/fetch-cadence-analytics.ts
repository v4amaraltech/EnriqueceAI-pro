'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchCadenceAnalyticsData } from '../services/cadence-analytics.service';
import type { CadenceAnalyticsData } from '../types/cadence-analytics.types';
import { getPeriodDates } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchCadenceAnalytics(
  period: string = '30d',
  userIds?: string[],
  cadenceId?: string,
  dateRange?: { from: string; to: string },
): Promise<ActionResult<CadenceAnalyticsData>> {
  try {
    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const { start, end } = dateRange
      ? { start: new Date(dateRange.from).toISOString(), end: new Date(dateRange.to + 'T23:59:59').toISOString() }
      : getPeriodDates(period);

    const data = await fetchCadenceAnalyticsData(
      supabase,
      orgId,
      start,
      end,
      userIds && userIds.length > 0 ? userIds : undefined,
      cadenceId || undefined,
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
