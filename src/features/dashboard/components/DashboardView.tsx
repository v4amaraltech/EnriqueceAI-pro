'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { differenceInCalendarDays } from 'date-fns';

import { CheckCircle2, TrendingUp, Users } from 'lucide-react';

import { Skeleton } from '@/shared/components/ui/skeleton';

import type { DashboardData, DashboardFilters, DashboardResponseTimeData, InsightsData, RankingData } from '../types';
import { ConversionByOriginChart } from './ConversionByOriginChart';
import { DashboardFilters as DashboardFiltersComponent } from './DashboardFilters';
import { GoalsModal } from './GoalsModal';
import { LossReasonsChart } from './LossReasonsChart';
import { OpportunityKpiCard } from './OpportunityKpiCard';
import { RankingCard } from './RankingCard';
import { ResponseTimeCard } from './ResponseTimeCard';

interface DashboardViewProps {
  data: DashboardData;
  filters: DashboardFilters;
  ranking?: RankingData;
  insights?: InsightsData;
  responseTime?: DashboardResponseTimeData;
}

export function DashboardView({ data, filters, ranking, insights, responseTime }: DashboardViewProps) {
  const router = useRouter();
  const [goalsOpen, setGoalsOpen] = useState(false);

  const handleSdrClick = useCallback((userId: string) => {
    router.push(`/leads?assigned_to=${userId}`);
  }, [router]);

  const handleActivitySdrClick = useCallback((_userId: string) => {
    router.push('/statistics/activities');
  }, [router]);

  // Calculate business days in the filter period for daily average
  const businessDays = useMemo(() => {
    if (!filters.dateFrom || !filters.dateTo) return 1;
    const from = new Date(filters.dateFrom);
    const to = new Date(filters.dateTo);
    let count = 0;
    const current = new Date(from);
    const totalDays = differenceInCalendarDays(to, from) + 1;
    for (let i = 0; i < totalDays; i++) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) count++;
      current.setDate(current.getDate() + 1);
    }
    return count || 1;
  }, [filters.dateFrom, filters.dateTo]);

  return (
    <div className="space-y-6">
      {/* Header: Title left, Filters + Edit goals right */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-normal text-foreground">Visão geral</h1>

        <div className="flex flex-wrap items-center gap-3">
          <Suspense fallback={<Skeleton className="h-6 w-64" />}>
            <DashboardFiltersComponent
              currentFilters={filters}
              availableCadences={data.availableCadences}
            />
          </Suspense>
          <button
            onClick={() => setGoalsOpen(true)}
            className="rounded-full border border-emerald-500 px-4 py-1.5 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
          >
            Editar metas
          </button>
        </div>
      </div>

      <GoalsModal open={goalsOpen} onOpenChange={setGoalsOpen} month={filters.month} />

      {/* KPI + Chart (unified card) */}
      <OpportunityKpiCard kpi={data.kpi} month={filters.month} />

      {/* Ranking Cards (Story 3.3) — equal height via grid stretch */}
      {ranking && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 [&>*]:min-h-[480px]" data-slot="ranking-cards">
          <RankingCard
            title="Leads Finalizados"
            titleTooltip={
              'Inscrições em cadência (enrollments) no período.\n\n' +
              '• Finalizados: enrollments com status completed ou replied\n' +
              '• Prospectando: enrollments com status active\n\n' +
              'Atribuído ao SDR via lead.assigned_to. Apenas usuários com role=SDR aparecem.'
            }
            icon={Users}
            iconColor="bg-blue-500/10"
            iconTextColor="text-blue-500"
            data={ranking.leadsFinished}
            primaryColumnLabel="finalizados"
            secondaryColumnLabel="prospectando"
            averageLabel="média finalizados/vendedor"
            onSdrClick={handleSdrClick}
          />
          <RankingCard
            title="Atividades Realizadas"
            titleTooltip={
              'Atividades enviadas (interactions com type=sent) no período, agrupadas por SDR via performed_by.\n\n' +
              'Exclui canais system e calendar. Não conta envios automáticos da cadência (sem performed_by).'
            }
            icon={CheckCircle2}
            iconColor="bg-amber-500/10"
            iconTextColor="text-amber-500"
            data={ranking.activitiesDone}
            primaryColumnLabel="média diária"
            primaryColumnTooltip="Total de atividades ÷ dias úteis no período"
            primaryValueDivisor={businessDays}
            averageLabel="média atividades/vendedor"
            onSdrClick={handleActivitySdrClick}
          />
          <RankingCard
            title="Taxa de Conversão"
            titleTooltip={
              'Conversão = leads ganhos no período ÷ leads trabalhados no período\n\n' +
              '• Numerador: leads com status=qualified e won_at dentro do período\n' +
              '• Denominador: leads que tiveram cadência iniciada no período (enrolled_at)\n\n' +
              'Atribuído ao SDR via lead.assigned_to. Apenas usuários com role=SDR.'
            }
            icon={TrendingUp}
            iconColor="bg-emerald-500/10"
            iconTextColor="text-emerald-500"
            unit="%"
            data={ranking.conversionRate}
            primaryColumnLabel="oportunidades"
            averageLabel="média conversão/vendedor"
            onSdrClick={handleActivitySdrClick}
          />
        </div>
      )}

      {/* Insights Charts (Story 3.4) */}
      {insights && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-h-[480px]" data-slot="insights-charts">
          <LossReasonsChart data={insights.lossReasons} />
          <ConversionByOriginChart data={insights.conversionByOrigin} filters={filters} />
        </div>
      )}

      {/* Response Time */}
      {responseTime && <ResponseTimeCard data={responseTime} />}
    </div>
  );
}
