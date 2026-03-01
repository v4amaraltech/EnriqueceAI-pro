import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { getDashboardData } from '@/features/dashboard/actions/get-dashboard-data';
import { getInsightsData } from '@/features/dashboard/actions/get-insights-data';
import { getRankingData } from '@/features/dashboard/actions/get-ranking-data';
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

  const [result, rankingResult, insightsResult] = await Promise.all([
    getDashboardData(filters),
    getRankingData(filters),
    getInsightsData(filters),
  ]);

  if (!result.success) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
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
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <DashboardView
        data={result.data}
        filters={filters}
        ranking={rankingResult.success ? rankingResult.data : undefined}
        insights={insightsResult.success ? insightsResult.data : undefined}
      />
    </div>
  );
}
