'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { differenceInCalendarDays } from 'date-fns';

import { CheckCircle2, DoorOpen, TrendingUp, Users } from 'lucide-react';

import { Skeleton } from '@/shared/components/ui/skeleton';

import type { DashboardData, DashboardFilters, DashboardResponseTimeData, InsightsData, OpportunityKpiData, RankingData } from '../types';
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

  const handleActivitySdrClick = useCallback((userId: string) => {
    router.push(`/leads?assigned_to=${userId}`);
  }, [router]);

  // Calculate business days in the filter period for daily average (BRT-aware)
  const businessDays = useMemo(() => {
    if (!filters.dateFrom || !filters.dateTo) return 1;
    const from = new Date(filters.dateFrom + 'T03:00:00Z');
    const to = new Date(filters.dateTo + 'T03:00:00Z');
    let count = 0;
    const current = new Date(from);
    const totalDays = differenceInCalendarDays(to, from) + 1;
    for (let i = 0; i < totalDays; i++) {
      const day = current.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      current.setUTCDate(current.getUTCDate() + 1);
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

      {/* Leads Abertos — number + daily cumulative chart vs target */}
      {ranking?.leadsOpened?.dailyData && (
        <OpportunityKpiCard
          kpi={{
            totalOpportunities: ranking.leadsOpened.total,
            monthTarget: ranking.leadsOpened.monthTarget,
            conversionTarget: 0,
            percentOfTarget: ranking.leadsOpened.percentOfTarget,
            currentDay: (() => {
              const now = new Date();
              const [yr, mo] = filters.month.split('-').map(Number) as [number, number];
              const days = new Date(yr, mo, 0).getDate();
              const isCurrent = now.getFullYear() === yr && now.getMonth() + 1 === mo;
              return isCurrent ? now.getDate() : days;
            })(),
            daysInMonth: ranking.leadsOpened.dailyData.length,
            dailyData: ranking.leadsOpened.dailyData,
          } satisfies OpportunityKpiData}
          month={filters.month}
          label="Leads abertos"
          labelTooltip="Leads com primeiro contato humano (email, WhatsApp, telefone, LinkedIn ou pesquisa) realizado por um SDR no período."
        />
      )}

      {/* Ranking Cards (Story 3.3) — equal height via grid stretch */}
      {ranking && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-h-[480px]" data-slot="ranking-cards">
          <RankingCard
            title="Leads Abertos"
            titleTooltip={
              'Quantos leads cada SDR abriu no período. "Abrir" = primeiro contato humano (email, WhatsApp, telefone, LinkedIn ou pesquisa).\n\n' +
              'Cada lead conta uma vez para o SDR que fez o primeiro contato. Gerentes não aparecem no ranking.'
            }
            icon={DoorOpen}
            iconColor="bg-sky-500/10"
            iconTextColor="text-sky-500"
            data={ranking.leadsOpened}
            primaryColumnLabel="abertos"
            averageLabel="média leads abertos/vendedor"
            onSdrClick={handleSdrClick}
          />
          <RankingCard
            title="Leads Finalizados"
            titleTooltip={
              'Quantos leads cada SDR colocou em cadência no período.\n\n' +
              '• Finalizados: leads cuja cadência foi concluída ou que responderam\n' +
              '• Prospectando: leads ainda em cadência ativa\n\n' +
              'Cada lead conta para o SDR responsável. Gerentes não aparecem no ranking.'
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
              'Quantas atividades cada SDR executou no período (e-mails, WhatsApp, ligações, etc.).\n\n' +
              'Conta apenas atividades feitas manualmente pelo SDR. Envios automáticos da cadência e eventos do sistema não entram.'
            }
            icon={CheckCircle2}
            iconColor="bg-amber-500/10"
            iconTextColor="text-amber-500"
            data={ranking.activitiesDone}
            primaryColumnLabel="média diária"
            primaryColumnTooltip="Total de atividades dividido pelos dias úteis do período"
            primaryValueDivisor={businessDays}
            averageLabel="média atividades/vendedor"
            onSdrClick={handleActivitySdrClick}
          />
          <RankingCard
            title="Taxa de Conversão"
            titleTooltip={
              'Quantos leads viraram oportunidade entre os que foram trabalhados no período.\n\n' +
              '• Numerador: leads marcados como ganhos no período\n' +
              '• Denominador: leads que entraram em cadência no período\n\n' +
              'Cada lead conta para o SDR responsável. Gerentes não aparecem no ranking.'
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
      {responseTime && <ResponseTimeCard data={responseTime} dateRange={filters.dateFrom && filters.dateTo ? { from: filters.dateFrom, to: filters.dateTo } : undefined} />}
    </div>
  );
}
