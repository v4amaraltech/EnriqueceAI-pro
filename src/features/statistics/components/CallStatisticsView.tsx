'use client';

import {
  Calendar,
  CircleHelp,
  Clock,
  MessageSquareText,
  Phone,
  PhoneCall,
  TrendingUp,
} from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';

import type { CallStatisticsData } from '../types/call-statistics.types';
import type { OrgMember } from '../types/shared';
import { formatDuration, formatDurationLong } from '../types/shared';
import { CallDispositionTable } from './CallDispositionTable';
import { CallEffectivenessBySdrTable } from './CallEffectivenessBySdrTable';
import { CallsPerSdrChart } from './CallsPerSdrChart';
import { ConversionFunnelChart } from './ConversionFunnelChart';
import { DurationDistributionChart } from './DurationDistributionChart';
import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import { TimeHeatmapGrid } from './TimeHeatmapGrid';

interface CallStatisticsViewProps {
  data: CallStatisticsData;
  members: OrgMember[];
}

export function CallStatisticsView({ data, members }: CallStatisticsViewProps) {
  const eff = data.effectiveness.summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ligações</h1>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Análise detalhada de ligações por status, duração e horário.
          </p>
        </div>
        <AnalyticsFilters basePath="/statistics/calls" members={members} />
      </div>

      {data.isTruncated && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
          Período muito longo: os números abaixo consideram só parte das ligações. Escolha um período
          menor para ver o total exato.
        </div>
      )}

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

      {/* Effectiveness KPI Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          title="Conversas relevantes"
          value={eff.relevantCalls}
          icon={MessageSquareText}
          description={`${eff.relevantRate}% das ligações — marcadas pelo SDR`}
        />
        <MetricCard
          title="Taxa de conexão"
          value={`${eff.connectionRate}%`}
          icon={PhoneCall}
          description={
            eff.totalCalls > 0 && !eff.hasTelephonyAnswerSignal
              ? 'A telefonia não confirmou nenhum atendimento no período — verifique a integração'
              : `${eff.connectedCalls} atendidas com 50s ou mais`
          }
        />
        <MetricCard
          title="Sem desfecho marcado"
          value={eff.withoutDispositionCalls}
          icon={CircleHelp}
          description={
            `${eff.withoutDispositionRate}% das ligações do discador — o SDR não informou o resultado` +
            (eff.externalCalls > 0
              ? ` · outras ${eff.externalCalls} foram feitas fora do discador (sem desfecho possível)`
              : '')
          }
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Efetividade das ligações</h2>
          {eff.totalCalls === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Nenhuma ligação no período.
            </div>
          ) : (
            <>
              <ConversionFunnelChart stages={data.effectiveness.funnel} />
              <ul className="mt-4 space-y-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                <li>
                  <strong>Atendidas:</strong> a telefonia confirmou conversa de 50s ou mais, ou o SDR
                  marcou que alguém atendeu. Caixa postal não conta.
                </li>
                <li>
                  <strong>Conversa relevante:</strong> o SDR marcou &quot;Conversa relevante&quot; ao
                  encerrar a ligação.
                </li>
                {eff.answeredWithoutDispositionCalls > 0 && (
                  <li>
                    {eff.answeredWithoutDispositionCalls} atendidas estão sem desfecho — não dá para
                    saber se foram relevantes.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Resultado das ligações</h2>
          <CallDispositionTable data={data.effectiveness.dispositions} />
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Distribuição de Duração</h2>
        <DurationDistributionChart data={data.durationDistribution} />
      </div>

      {/* Heatmap */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Mapa de Calor — Dia × Horário</h2>
        <TimeHeatmapGrid data={data.heatmap} />
      </div>

      {/* Effectiveness by SDR */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Efetividade por SDR</h2>
        <CallEffectivenessBySdrTable data={data.effectiveness.bySdr} />
      </div>

      {/* Calls by SDR */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Ligações por SDR</h2>
        <CallsPerSdrChart data={data.callsBySdr} />
      </div>
    </div>
  );
}
