'use client';

import { Award, Target, TrendingUp, Users } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';

import type { PerformanceAnalyticsData } from '../types/performance-analytics.types';
import { DailySdrPerformanceChart } from './DailySdrPerformanceChart';
import { SdrActivityComparisonChart } from './SdrActivityComparisonChart';
import { SdrPerformanceTable } from './SdrPerformanceTable';

interface PerformanceAnalyticsViewProps {
  data: PerformanceAnalyticsData;
}

export function PerformanceAnalyticsView({ data }: PerformanceAnalyticsViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Desempenho</h1>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Métricas de desempenho individual e da equipe de vendas.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Atividades"
          value={data.totalActivities.toLocaleString('pt-BR')}
          icon={TrendingUp}
        />
        <MetricCard
          title="Leads Criados"
          value={data.totalLeadsCreated.toLocaleString('pt-BR')}
          icon={Users}
        />
        <MetricCard
          title="Leads Qualificados"
          value={data.totalQualified.toLocaleString('pt-BR')}
          icon={Award}
        />
        <MetricCard
          title="Taxa de Qualificação"
          value={`${data.qualificationRate}%`}
          icon={Target}
        />
      </div>

      {/* SDR Ranking Table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Ranking de SDRs</h2>
        <SdrPerformanceTable data={data.sdrTable} />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Atividades por SDR</h2>
          <SdrActivityComparisonChart data={data.sdrComparison} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Tendência Diária (Top 5)</h2>
          <DailySdrPerformanceChart data={data.dailySdrTrend} sdrKeys={data.dailySdrKeys} />
        </div>
      </div>
    </div>
  );
}
