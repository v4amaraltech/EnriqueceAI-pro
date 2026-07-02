'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { differenceInCalendarDays } from 'date-fns';

import { AlarmClock, CalendarCheck2, CheckCircle2, DoorOpen, Handshake, Inbox, Percent, UserCheck } from 'lucide-react';

import { Skeleton } from '@/shared/components/ui/skeleton';

import type { DashboardData, DashboardFilters, DashboardResponseTimeData, InsightsData, OpportunityKpiData, RankingData } from '../types';
import { currentDayOfMonthBrt } from '../utils/brt-now';
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

  const handleLeadsToOpenSdrClick = useCallback((userId: string) => {
    router.push(`/leads?assigned_to=${userId}&status=new`);
  }, [router]);

  const handleOverdueSdrClick = useCallback((userId: string) => {
    // Não temos filtro "overdue" na lista de leads ainda — abre o pipe do SDR
    // e deixa o gestor inspecionar manualmente. Pode evoluir pra
    // /atividades?assigned_to=X&status=overdue quando a queue aceitar param.
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

      {/* Leads Abertos — primeiro do funil */}
      {ranking?.leadsOpened?.dailyData && (
        <OpportunityKpiCard
          kpi={{
            totalOpportunities: ranking.leadsOpened.total,
            monthTarget: ranking.leadsOpened.monthTarget,
            conversionTarget: 0,
            percentOfTarget: ranking.leadsOpened.percentOfTarget,
            currentDay: currentDayOfMonthBrt(filters.month),
            daysInMonth: ranking.leadsOpened.dailyData.length,
            dailyData: ranking.leadsOpened.dailyData,
          } satisfies OpportunityKpiData}
          month={filters.month}
          label="Leads abertos"
          labelTooltip={
            'Quantos leads tiveram o 1º contato humano neste mês.\n\n' +
            '• Conta uma vez por lead, no mês do primeiro contato (não a cada atividade).\n' +
            '• Vale qualquer canal humano: e-mail, WhatsApp, telefone, LinkedIn ou pesquisa — fazer a pesquisa do lead já o abre.\n' +
            '• É creditado ao SDR dono do lead.\n\n' +
            'Não conta: notas importadas, leads arquivados, leads sem responsável, e o que não é um contato enviado (abertura, clique, resposta).\n\n' +
            'Atualiza em tempo real: sobe conforme novos leads recebem o 1º contato e pode recuar se o lead for arquivado, reatribuído, ou se um contato mais antigo dele entrar no sistema depois (reclassificando-o para o mês certo).'
          }
        />
      )}

      {/* Reuniões marcadas — meio do funil */}
      {ranking?.meetingsScheduled?.dailyData && (
        <OpportunityKpiCard
          kpi={{
            totalOpportunities: ranking.meetingsScheduled.total,
            monthTarget: ranking.meetingsScheduled.monthTarget,
            conversionTarget: 0,
            percentOfTarget: ranking.meetingsScheduled.percentOfTarget,
            currentDay: currentDayOfMonthBrt(filters.month),
            daysInMonth: ranking.meetingsScheduled.dailyData.length,
            dailyData: ranking.meetingsScheduled.dailyData,
          } satisfies OpportunityKpiData}
          month={filters.month}
          label="Reuniões marcadas"
          labelTooltip="Leads com meeting_scheduled_at preenchido no período (reunião agendada)."
        />
      )}

      {/* Reuniões realizadas — bottom do funil (era "Oportunidades") */}
      <OpportunityKpiCard
        kpi={data.kpi}
        month={filters.month}
        label="Reuniões realizadas"
        labelTooltip="Reuniões realizadas no mês — leads marcados como ganho (status='won')."
      />

      {/* Ranking Cards — funnel order: Abertos → Marcadas → Realizadas → Hit Rate */}
      {ranking && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-h-[480px]" data-slot="ranking-cards">
          <RankingCard
            title="Leads Abertos"
            titleTooltip={
              'Quantos leads cada SDR abriu no período. "Abrir" = primeiro contato humano (email, WhatsApp, telefone, LinkedIn ou pesquisa).\n\n' +
              'Cada lead conta uma única vez, no mês do 1º contato, para o SDR responsável por ele (não para quem fez a interação). O número é recalculado em tempo real e pode oscilar ao longo do dia. Gerentes não aparecem no ranking.'
            }
            icon={DoorOpen}
            iconColor="bg-sky-500/10"
            iconTextColor="text-sky-500"
            data={ranking.leadsOpened}
            primaryColumnLabel="abertos"
            idealColumnLabel="ideal dia"
            idealColumnTooltip="Onde cada SDR deveria estar hoje: meta do mês ÷ SDRs com meta individual definida, no ritmo de dias úteis (sem feriados)."
            averageLabel="média leads abertos/vendedor"
            onSdrClick={handleSdrClick}
          />
          <RankingCard
            title="Reuniões Marcadas"
            titleTooltip={
              'Quantas reuniões cada SDR marcou no período (campo meeting_scheduled_at do lead).\n\n' +
              'Cada lead conta para o SDR responsável. Gerentes não aparecem no ranking.'
            }
            icon={CalendarCheck2}
            iconColor="bg-indigo-500/10"
            iconTextColor="text-indigo-500"
            data={ranking.meetingsScheduled}
            primaryColumnLabel="marcadas"
            idealColumnLabel="ideal dia"
            idealColumnTooltip="Onde cada SDR deveria estar hoje: meta do mês ÷ SDRs com meta individual definida, no ritmo de dias úteis (sem feriados)."
            averageLabel="média reuniões marcadas/vendedor"
            onSdrClick={handleSdrClick}
          />
          <RankingCard
            title="Reuniões Realizadas"
            titleTooltip={
              'Quantas reuniões realizadas (oportunidades) cada SDR teve no período. Conta leads marcados como ganhos.\n\n' +
              'Cada lead conta para o SDR responsável. Gerentes não aparecem no ranking.'
            }
            icon={Handshake}
            iconColor="bg-emerald-500/10"
            iconTextColor="text-emerald-500"
            data={ranking.meetingsHeld}
            primaryColumnLabel="realizadas"
            idealColumnLabel="ideal dia"
            idealColumnTooltip="Onde cada SDR deveria estar hoje: meta do mês ÷ SDRs com meta individual definida, no ritmo de dias úteis (sem feriados)."
            averageLabel="média reuniões realizadas/vendedor"
            onSdrClick={handleSdrClick}
          />
          <RankingCard
            title="Hit Rate"
            titleTooltip={
              'Taxa de conversão de Lead Aberto para Reunião Realizada no período.\n\n' +
              '• Numerador: reuniões realizadas (leads ganhos)\n' +
              '• Denominador: leads abertos (primeiro contato humano)\n\n' +
              'Cada lead conta para o SDR responsável. Gerentes não aparecem no ranking.'
            }
            icon={Percent}
            iconColor="bg-rose-500/10"
            iconTextColor="text-rose-500"
            unit="%"
            data={ranking.hitRate}
            primaryColumnLabel="realizadas"
            averageLabel="média hit rate/vendedor"
            onSdrClick={handleSdrClick}
          />
        </div>
      )}

      {/* Operational ranking — cadence execution + conversion */}
      {ranking && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-h-[480px]" data-slot="ranking-cards-ops">
          <RankingCard
            title="Leads para Abrir"
            titleTooltip={
              'Snapshot agora: quantos leads novos cada SDR tem na fila para colocar em cadência.\n\n' +
              '• Leads com status "Novo" atribuídos ao SDR\n' +
              '• Que ainda NÃO têm cadência ativa\n\n' +
              'Filtro de período não afeta este card — é a fila atual.'
            }
            icon={Inbox}
            iconColor="bg-sky-500/10"
            iconTextColor="text-sky-500"
            data={ranking.leadsToOpen}
            primaryColumnLabel="na fila"
            averageLabel="média na fila/vendedor"
            onSdrClick={handleLeadsToOpenSdrClick}
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
            title="Atividades Atrasadas"
            titleTooltip={
              'Snapshot agora: quantas atividades de cadência cada SDR tem com vencimento há mais de 4 horas.\n\n' +
              '• Mesma definição que a Execução usa pro badge vermelho na fila\n' +
              '• Trigger de fim de semana já está aplicado: sex 18h não vira atrasada na seg 8h\n' +
              '• Não conta atividades de leads ganhos, perdidos ou arquivados\n\n' +
              'Filtro de período não afeta este card — é a fila atual.'
            }
            icon={AlarmClock}
            iconColor="bg-red-500/10"
            iconTextColor="text-red-500"
            data={ranking.overdueActivities}
            primaryColumnLabel="atrasadas"
            averageLabel="média atrasadas/vendedor"
            onSdrClick={handleOverdueSdrClick}
          />
          <RankingCard
            title="Taxa de Comparecimento"
            titleTooltip={
              'Das reuniões marcadas, quantas o lead efetivamente compareceu (virou reunião realizada). O inverso é o no-show.\n\n' +
              '• Numerador: reuniões realizadas (leads ganhos)\n' +
              '• Denominador: reuniões marcadas\n\n' +
              'Marcadas e realizadas são contadas dentro do período — pode passar de 100% quando reuniões marcadas em meses anteriores são realizadas agora. Cada lead conta para o SDR responsável. Gerentes não aparecem no ranking.'
            }
            icon={UserCheck}
            iconColor="bg-teal-500/10"
            iconTextColor="text-teal-500"
            unit="%"
            data={ranking.attendanceRate}
            primaryColumnLabel="realizadas"
            averageLabel="média comparecimento/vendedor"
            onSdrClick={handleSdrClick}
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
