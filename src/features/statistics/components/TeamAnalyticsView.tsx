'use client';

import type { OrgMember } from '../types/shared';
import type { TeamAnalyticsData } from '../types/team-analytics.types';
import { GoalAchievementGrid } from './GoalAchievementGrid';
import { SdrComparisonTable } from './SdrComparisonTable';
import { SdrPerformanceTrendChart } from './SdrPerformanceTrendChart';
import { SdrRankingSection } from './SdrRankingSection';
import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';

interface TeamAnalyticsViewProps {
  data: TeamAnalyticsData;
  members: OrgMember[];
  previousData?: TeamAnalyticsData;
}

export function TeamAnalyticsView({ data, members, previousData }: TeamAnalyticsViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Equipe</h1>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Comparativo de performance dos SDRs.
          </p>
        </div>
        <AnalyticsFilters
          basePath="/statistics/team"
          members={members}
        />
      </div>

      {/* Comparison table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Tabela Comparativa</h2>
        <SdrComparisonTable data={data.comparison} previousData={previousData?.comparison} />
      </div>

      {/* Trend chart */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Tendência de Atividades</h2>
        <SdrPerformanceTrendChart data={data.trends} sdrNames={data.sdrNames} />
      </div>

      {/* Rankings */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Ranking</h2>
        <SdrRankingSection rankings={data.rankings} />
      </div>

      {/* Goals */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Metas de Hoje</h2>
        <GoalAchievementGrid goals={data.goals} />
      </div>
    </div>
  );
}
