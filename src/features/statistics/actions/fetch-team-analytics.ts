'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchTeamAnalyticsData } from '../services/team-analytics.service';
import type { TeamAnalyticsData } from '../types/team-analytics.types';
import { getPeriodDates } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchTeamAnalytics(
  period: string = '30d',
  dateRange?: { from: string; to: string },
): Promise<ActionResult<TeamAnalyticsData>> {
  try {
    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const { start, end } = dateRange
      ? { start: new Date(dateRange.from).toISOString(), end: new Date(dateRange.to + 'T23:59:59').toISOString() }
      : getPeriodDates(period);

    const data = await fetchTeamAnalyticsData(supabase, orgId, start, end);

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
