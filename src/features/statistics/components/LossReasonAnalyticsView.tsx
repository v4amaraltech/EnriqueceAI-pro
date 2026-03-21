'use client';

import { AlertTriangle, Hash, TrendingDown } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';

import type { LossReasonAnalyticsData } from '../types/loss-reason-analytics.types';
import { LossByCadenceTable } from './LossByCadenceTable';
import { LossReasonsBarChart } from './LossReasonsBarChart';
import { LossReasonsDonutChart } from './LossReasonsDonutChart';

interface LossReasonAnalyticsViewProps {
  data: LossReasonAnalyticsData;
}

export function LossReasonAnalyticsView({ data }: LossReasonAnalyticsViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Motivos de Perda</h1>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Análise dos motivos de perda e distribuição por cadência.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          title="Total Perdidos"
          value={data.totalLost.toLocaleString('pt-BR')}
          icon={TrendingDown}
          description={`de ${data.totalEnrolled.toLocaleString('pt-BR')} inscritos`}
        />
        <MetricCard
          title="Motivo #1"
          value={data.topReasonName}
          icon={AlertTriangle}
          description={`${data.topReasonCount} ocorrências`}
        />
        <MetricCard
          title="Taxa de Perda Geral"
          value={`${data.overallLossRate}%`}
          icon={Hash}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Ranking de Motivos</h2>
          <LossReasonsBarChart data={data.reasonsRanking} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Distribuição</h2>
          <LossReasonsDonutChart data={data.reasonsRanking} />
        </div>
      </div>

      {/* Loss by Cadence Table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Perdas por Cadência</h2>
        <LossByCadenceTable data={data.lossByCadence} />
      </div>
    </div>
  );
}
