'use client';

import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import type { CadenceOption } from '@/shared/components/AnalyticsFilters';
import { DrilldownDrawer } from '@/shared/components/drilldown/DrilldownDrawer';
import { useDateRange } from '@/shared/hooks/useDateRange';
import { useDrilldown } from '@/shared/hooks/useDrilldown';

import type { ConversionAnalyticsData } from '../types/conversion-analytics.types';
import type { FunnelStage } from '../types/conversion-analytics.types';
import type { OrgMember } from '../types/shared';
import { ConversionByCadenceTable } from './ConversionByCadenceTable';
import { ConversionFunnelChart } from './ConversionFunnelChart';
import { PipelineVelocityCard } from './PipelineVelocityCard';
import { StageToStageCards } from './StageToStageCards';

interface ConversionAnalyticsViewProps {
  data: ConversionAnalyticsData;
  members: OrgMember[];
  cadences?: CadenceOption[];
  hideFilters?: boolean;
  previousData?: ConversionAnalyticsData;
}

const STAGE_LABEL_MAP: Record<string, string> = {
  Novo: 'new',
  Contactado: 'contacted',
  Qualificado: 'qualified',
  Desqualificado: 'unqualified',
  Arquivado: 'archived',
};

export function ConversionAnalyticsView({ data, members, cadences, hideFilters, previousData }: ConversionAnalyticsViewProps) {
  const { from, to } = useDateRange('/statistics/conversion');
  const drilldown = useDrilldown();

  function handleStageClick(stage: FunnelStage) {
    const status = STAGE_LABEL_MAP[stage.label];
    if (status) {
      drilldown.open('conversion_stage', { from, to, stage: status });
    }
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

      {/* Funnel */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Funil de Conversão</h2>
        <ConversionFunnelChart stages={data.funnel} onStageClick={handleStageClick} />
      </div>

      {/* Stage-to-stage */}
      <StageToStageCards conversions={data.stageConversions} previousConversions={previousData?.stageConversions} />

      {/* Velocity */}
      <PipelineVelocityCard velocity={data.velocity} />

      {/* Cadence conversion table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Conversão por Cadência</h2>
        <ConversionByCadenceTable data={data.cadenceConversion} />
      </div>

      <DrilldownDrawer {...drilldown} />
    </div>
  );
}
