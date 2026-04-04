'use client';

import { Award, TrendingUp, Users } from 'lucide-react';

import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import type { CadenceOption } from '@/shared/components/AnalyticsFilters';
import { DrilldownDrawer } from '@/shared/components/drilldown/DrilldownDrawer';
import { useDateRange } from '@/shared/hooks/useDateRange';
import { useDrilldown } from '@/shared/hooks/useDrilldown';

import type { ConversionAnalyticsData, FunnelStage } from '../types/conversion-analytics.types';
import type { OrgMember } from '../types/shared';
import { ConversionByCadenceTable } from './ConversionByCadenceTable';
import { ConversionFunnelChart } from './ConversionFunnelChart';

const STAGE_LABEL_MAP: Record<string, string> = {
  Novo: 'new',
  Contactado: 'contacted',
  Qualificado: 'qualified',
  Desqualificado: 'unqualified',
  Arquivado: 'archived',
};

function BigKpiCard({ value, label, icon: Icon, color }: { value: string; label: string; icon: typeof Users; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--muted)]">
        <Icon className="h-6 w-6" style={color ? { color } : undefined} />
      </div>
      <p className="text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{label}</p>
    </div>
  );
}

interface ConversionAnalyticsViewProps {
  data: ConversionAnalyticsData;
  members: OrgMember[];
  cadences?: CadenceOption[];
  hideFilters?: boolean;
  previousData?: ConversionAnalyticsData;
}

export function ConversionAnalyticsView({ data, members, cadences, hideFilters, previousData: _previousData }: ConversionAnalyticsViewProps) {
  const { from, to } = useDateRange('/statistics/conversion');
  const drilldown = useDrilldown();

  const qualified = data.funnel.find((s) => s.label === 'Qualificado');
  const totalLeads = data.funnel[0]?.count ?? 0;
  const conversionRate = totalLeads > 0 && qualified ? ((qualified.count / totalLeads) * 100).toFixed(0) : '0';

  function handleStageClick(stage: FunnelStage) {
    const status = STAGE_LABEL_MAP[stage.label];
    if (status) drilldown.open('conversion_stage', { from, to, stage: status });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conversão</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Funil de conversão e análise por cadência.
          </p>
        </div>
        {!hideFilters && (
          <AnalyticsFilters basePath="/statistics/conversion" members={members} cadences={cadences} />
        )}
      </div>

      {/* Big KPI + summary */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="text-4xl font-bold">{qualified?.count ?? 0}</span>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">Oportunidades no período</p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-green-600 dark:text-green-400 font-semibold">
                {conversionRate}% taxa de conversão
              </span>
              <span className="text-[var(--muted-foreground)]">de {totalLeads} leads</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <span>Tempo médio: <strong>{data.velocity.avgDaysToQualification} dias</strong></span>
            <span className="text-[var(--border)]">|</span>
            <span>Mediana: <strong>{data.velocity.medianDaysToQualification} dias</strong></span>
          </div>
        </div>
      </div>

      {/* 3 ranking cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <BigKpiCard value={totalLeads.toLocaleString('pt-BR')} label="Leads no período" icon={Users} />
        <BigKpiCard value={(qualified?.count ?? 0).toLocaleString('pt-BR')} label="Qualificados" icon={Award} color="var(--color-primary-500)" />
        <BigKpiCard value={`${conversionRate}%`} label="Taxa de Conversão" icon={TrendingUp} color="var(--primary)" />
      </div>

      {/* Funnel */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Funil de Conversão</h2>
        <ConversionFunnelChart stages={data.funnel} onStageClick={handleStageClick} />
      </div>

      {/* Cadence conversion table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Conversão por Cadência</h2>
        <ConversionByCadenceTable data={data.cadenceConversion} />
      </div>

      <DrilldownDrawer {...drilldown} />
    </div>
  );
}
