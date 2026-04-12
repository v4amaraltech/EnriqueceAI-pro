export const dynamic = 'force-dynamic';

import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { getDashboardData } from '@/features/dashboard/actions/get-dashboard-data';
import { getInsightsData } from '@/features/dashboard/actions/get-insights-data';
import { getRankingData } from '@/features/dashboard/actions/get-ranking-data';
import { getResponseTimeData } from '@/features/dashboard/actions/get-response-time';
import { DashboardView } from '@/features/dashboard/components/DashboardView';
import type { DashboardFilters } from '@/features/dashboard/types';

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getDefaultDateRange(): { from: string; to: string; month: string } {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: format(firstOfMonth, 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAuth();

  const params = await searchParams;
  const defaults = getDefaultDateRange();

  const dateFrom = typeof params.dateFrom === 'string' ? params.dateFrom : defaults.from;
  const dateTo = typeof params.dateTo === 'string' ? params.dateTo : defaults.to;

  // Derive month from dateTo (use most recent month as reference for goals/charts)
  const month = typeof params.month === 'string'
    ? params.month
    : dateTo.slice(0, 7);

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

  const [result, rankingResult, insightsResult, responseTimeResult] = await Promise.all([
    safe(getDashboardData(filters), { success: false as const, error: 'Erro ao carregar métricas' }),
    safe(getRankingData(filters), { success: false as const, error: 'Erro ao carregar ranking' }),
    safe(getInsightsData(filters), { success: false as const, error: 'Erro ao carregar insights' }),
    safe(getResponseTimeData(30, { from: dateFrom, to: dateTo }), { success: false as const, error: 'Erro ao carregar tempo de resposta' }),
  ]);

  if (!result.success) {
    return (
      <div className="mx-auto max-w-[1600px] px-10">
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
    <div className="mx-auto max-w-[1600px] px-10">
      <DashboardView
        data={result.data}
        filters={filters}
        ranking={rankingResult.success ? rankingResult.data : undefined}
        insights={insightsResult.success ? insightsResult.data : undefined}
        responseTime={responseTimeResult.success ? responseTimeResult.data : undefined}
      />
    </div>
  );
}
