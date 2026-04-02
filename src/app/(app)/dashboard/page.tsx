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

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAuth();

  const params = await searchParams;

  const filters: DashboardFilters = {
    month: typeof params.month === 'string' ? params.month : getCurrentMonth(),
    cadenceIds: typeof params.cadenceIds === 'string'
      ? params.cadenceIds.split(',').filter(Boolean)
      : [],
    userIds: typeof params.userIds === 'string'
      ? params.userIds.split(',').filter(Boolean)
      : [],
  };

  // Build date range from month filter for response time component
  const [year, mon] = filters.month.split('-').map(Number) as [number, number];
  const monthFrom = `${filters.month}-01`;
  const monthTo = new Date(year, mon, 0).toISOString().slice(0, 10); // last day of month

  const [result, rankingResult, insightsResult, responseTimeResult] = await Promise.all([
    getDashboardData(filters),
    getRankingData(filters),
    getInsightsData(filters),
    getResponseTimeData(30, { from: monthFrom, to: monthTo }),
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
