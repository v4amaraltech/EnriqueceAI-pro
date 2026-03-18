'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { StatisticsData, StatisticsFilters } from '../services/statistics.service';
import {
  fetchConversionByOrigin,
  fetchLossReasonStats,
  fetchResponseTimeData,
} from '../services/statistics.service';

function getPeriodDates(period: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
    default:
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }

  return { start: start.toISOString(), end };
}

export async function fetchStatisticsData(
  period: string = '30d',
  userIds?: string[],
  thresholdMinutes?: number,
  dateRange?: { from: string; to: string },
): Promise<ActionResult<StatisticsData>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { start, end } = dateRange
    ? { start: new Date(dateRange.from).toISOString(), end: new Date(dateRange.to + 'T23:59:59').toISOString() }
    : getPeriodDates(period);

  const filters: StatisticsFilters = {
    periodStart: start,
    periodEnd: end,
    userIds: userIds && userIds.length > 0 ? userIds : undefined,
    thresholdMinutes: thresholdMinutes ?? 60,
  };

  const [lossReasons, conversionByOrigin, responseTime] = await Promise.all([
    fetchLossReasonStats(supabase, member.org_id, filters),
    fetchConversionByOrigin(supabase, member.org_id, filters),
    fetchResponseTimeData(supabase, member.org_id, filters),
  ]);

  return {
    success: true,
    data: {
      lossReasons,
      conversionByOrigin,
      responseTime,
    },
  };
}
