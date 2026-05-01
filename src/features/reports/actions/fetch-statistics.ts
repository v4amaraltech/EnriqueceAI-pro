'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

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
    case 'today': {
      const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const todayStr = nowBrt.toISOString().split('T')[0];
      start = new Date(`${todayStr}T03:00:00Z`);
      break;
    }
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
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId, supabase } = auth.data;

    const { start, end } = dateRange
      ? { start: `${dateRange.from}T03:00:00Z`, end: `${dateRange.to}T23:59:59-03:00` }
      : getPeriodDates(period);

    const filters: StatisticsFilters = {
      periodStart: start,
      periodEnd: end,
      userIds: userIds && userIds.length > 0 ? userIds : undefined,
      thresholdMinutes: thresholdMinutes ?? 60,
    };

    const [lossReasons, conversionByOrigin, responseTime] = await Promise.all([
      fetchLossReasonStats(supabase, orgId, filters),
      fetchConversionByOrigin(supabase, orgId, filters),
      fetchResponseTimeData(supabase, orgId, filters),
    ]);

    return {
      success: true,
      data: {
        lossReasons,
        conversionByOrigin,
        responseTime,
      },
    };
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
