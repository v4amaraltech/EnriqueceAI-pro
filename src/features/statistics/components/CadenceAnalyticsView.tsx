'use client';

import { GitBranch, Reply, Target, Users } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';

import type { CadenceAnalyticsData } from '../types/cadence-analytics.types';
import { CadenceEnrollmentsByStatusChart } from './CadenceEnrollmentsByStatusChart';
import { CadencePerformanceTable } from './CadencePerformanceTable';
import { StepProgressionChart } from './StepProgressionChart';

interface CadenceAnalyticsViewProps {
  data: CadenceAnalyticsData;
}

export function CadenceAnalyticsView({ data }: CadenceAnalyticsViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Cadências</h1>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Desempenho das cadências, inscrições e progressão por etapa.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Cadências Ativas"
          value={data.activeCadences}
          icon={GitBranch}
        />
        <MetricCard
          title="Total Inscritos"
          value={data.totalEnrolled.toLocaleString('pt-BR')}
          icon={Users}
        />
        <MetricCard
          title="Taxa de Conclusão"
          value={`${data.completionRate}%`}
          icon={Target}
        />
        <MetricCard
          title="Taxa de Resposta"
          value={`${data.replyRate}%`}
          icon={Reply}
        />
      </div>

      {/* Performance Table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Desempenho por Cadência</h2>
        <CadencePerformanceTable data={data.cadenceTable} />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Inscritos por Status</h2>
          <CadenceEnrollmentsByStatusChart data={data.enrollmentsByStatus} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Progressão por Etapa</h2>
          <StepProgressionChart data={data.stepProgression} />
        </div>
      </div>
    </div>
  );
}
