'use client';

import { Calendar, Clock, Phone, TrendingUp } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';

import type { CallStatisticsData } from '../types/call-statistics.types';
import type { OrgMember } from '../types/shared';
import { formatDuration, formatDurationLong } from '../types/shared';
import { CallOutcomeBarChart } from './CallOutcomeBarChart';
import { CallsPerSdrChart } from './CallsPerSdrChart';
import { DurationDistributionChart } from './DurationDistributionChart';
import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import { TimeHeatmapGrid } from './TimeHeatmapGrid';

interface CallStatisticsViewProps {
  data: CallStatisticsData;
  members: OrgMember[];
}

export function CallStatisticsView({ data, members }: CallStatisticsViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ligações</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Análise detalhada de ligações por status, duração e horário.
          </p>
        </div>
        <AnalyticsFilters basePath="/statistics/calls" members={members} />
      </div>

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Total"
          value={data.kpis.totalCalls}
          icon={Phone}
        />
        <MetricCard
          title="Duração Total"
          value={formatDurationLong(data.kpis.totalDurationSeconds)}
          icon={Clock}
        />
        <MetricCard
          title="Duração Média"
          value={formatDuration(data.kpis.avgDurationSeconds)}
          icon={Clock}
        />
        <MetricCard
          title="Melhor Dia"
          value={data.kpis.bestDay}
          icon={Calendar}
        />
        <MetricCard
          title="Melhor Hora"
          value={data.kpis.bestHour}
          icon={TrendingUp}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Outcomes por Status</h2>
          <CallOutcomeBarChart data={data.outcomes} />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Distribuição de Duração</h2>
          <DurationDistributionChart data={data.durationDistribution} />
        </div>
      </div>

      {/* Heatmap */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Mapa de Calor — Dia × Horário</h2>
        <TimeHeatmapGrid data={data.heatmap} />
      </div>

      {/* Calls by SDR */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Ligações por SDR</h2>
        <CallsPerSdrChart data={data.callsBySdr} />
      </div>
    </div>
  );
}
