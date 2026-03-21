'use client';

import { Clock, Phone, PhoneCall, TrendingUp } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';

import type { CallDashboardData } from '../types/call-dashboard.types';
import type { OrgMember } from '../types/shared';
import { formatDuration } from '../types/shared';
import { CallOutcomePieChart } from './CallOutcomePieChart';
import { HourlyDistributionChart } from './HourlyDistributionChart';
import { RecentTeamCallsTable } from './RecentTeamCallsTable';
import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';

interface CallDashboardViewProps {
  data: CallDashboardData;
  members: OrgMember[];
}

export function CallDashboardView({ data, members }: CallDashboardViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Painel de Ligações</h1>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Visão geral das ligações da equipe.
          </p>
        </div>
        <AnalyticsFilters basePath="/calls/dashboard" members={members} />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Ligações"
          value={data.kpis.totalCalls}
          icon={Phone}
          description="no período selecionado"
        />
        <MetricCard
          title="Duração Média"
          value={formatDuration(data.kpis.avgDurationSeconds)}
          icon={Clock}
          description="mm:ss por ligação"
        />
        <MetricCard
          title="Taxa de Conexão"
          value={`${data.kpis.connectionRate}%`}
          icon={PhoneCall}
          description="ligações conectadas"
        />
        <MetricCard
          title="Taxa de Significativas"
          value={`${data.kpis.significantRate}%`}
          icon={TrendingUp}
          description="ligações significativas"
        />
      </div>

      {/* Charts grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Distribuição por Status</h2>
          <CallOutcomePieChart data={data.outcomes} />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Ligações por Hora do Dia</h2>
          <HourlyDistributionChart data={data.hourlyDistribution} />
        </div>
      </div>

      {/* Recent calls table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Últimas Ligações da Equipe</h2>
        <RecentTeamCallsTable calls={data.recentCalls} />
      </div>
    </div>
  );
}
