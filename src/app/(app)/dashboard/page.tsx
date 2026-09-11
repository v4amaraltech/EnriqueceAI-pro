export const dynamic = 'force-dynamic';

import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';
import { isUuid } from '@/lib/utils/uuid';

import { EmptyState } from '@/shared/components/EmptyState';

import { getDashboardData } from '@/features/dashboard/actions/get-dashboard-data';
import { getInsightsData } from '@/features/dashboard/actions/get-insights-data';
import { getRankingData } from '@/features/dashboard/actions/get-ranking-data';
import { getResponseTimeData } from '@/features/dashboard/actions/get-response-time';
import { getSdrPaceData } from '@/features/dashboard/actions/get-sdr-pace-data';
import { DashboardView } from '@/features/dashboard/components/DashboardView';
import type { DashboardFilters } from '@/features/dashboard/types';
import { brtNowParts, currentMonthBrt } from '@/features/dashboard/utils/brt-now';

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAuth();

  const params = await searchParams;

  // Month-based filter (primary) — dateFrom/dateTo derived from month.
  // Default is the current month in BRT (not UTC), so it only rolls to the next
  // month at 00:00 BRT — otherwise it flipped a day early at 21:00 BRT.
  const month = typeof params.month === 'string'
    ? params.month
    : currentMonthBrt();

  // Derive date range from month, clamping the end to "today" in BRT.
  const [yearStr, monthStr] = month.split('-');
  const monthStart = `${yearStr}-${monthStr}-01`;
  const monthEndDate = new Date(Number(yearStr), Number(monthStr), 0);
  const brtToday = brtNowParts();
  const today = new Date(brtToday.year, brtToday.month1 - 1, brtToday.day);
  const effectiveEnd = monthEndDate < today ? monthEndDate : today;
  const dateFrom = monthStart;
  const dateTo = format(effectiveEnd, 'yyyy-MM-dd');

  const filters: DashboardFilters = {
    month,
    cadenceIds: typeof params.cadenceIds === 'string'
      ? params.cadenceIds.split(',').filter(Boolean)
      : [],
    userIds: typeof params.userIds === 'string'
      ? params.userIds.split(',').filter(Boolean)
      : [],
    dateFrom,
    dateTo,
  };

  const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
    p.catch((err) => { console.error('[dashboard] Query failed:', err); return fallback; });

  // SDR da seção "SDR selecionado" — inválido/ausente cai no padrão da action.
  const sdrParam = typeof params.sdr === 'string' && isUuid(params.sdr) ? params.sdr : undefined;

  const [result, rankingResult, insightsResult, responseTimeResult, sdrPaceResult] = await Promise.all([
    safe(getDashboardData(filters), { success: false as const, error: 'Erro ao carregar métricas' }),
    safe(getRankingData(filters), { success: false as const, error: 'Erro ao carregar ranking' }),
    safe(getInsightsData(filters), { success: false as const, error: 'Erro ao carregar insights' }),
    safe(getResponseTimeData(30, { from: dateFrom, to: dateTo }), { success: false as const, error: 'Erro ao carregar tempo de resposta' }),
    safe(getSdrPaceData({ month, userId: sdrParam }), { success: false as const, error: 'Erro ao carregar SDR selecionado' }),
  ]);

  if (!result.success) {
    return (
      <div>
        <h1 className="mb-6 text-lg font-normal text-foreground">Visão geral</h1>
        <EmptyState
          icon={AlertTriangle}
          title="Erro ao carregar métricas"
          description={result.error}
        />
      </div>
    );
  }

  return (
    <div>
      <DashboardView
        data={result.data}
        filters={filters}
        ranking={rankingResult.success ? rankingResult.data : undefined}
        insights={insightsResult.success ? insightsResult.data : undefined}
        responseTime={responseTimeResult.success ? responseTimeResult.data : undefined}
        sdrPace={sdrPaceResult.success ? sdrPaceResult.data : undefined}
      />
    </div>
  );
}
