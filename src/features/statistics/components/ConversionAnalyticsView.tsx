'use client';

import type { ConversionAnalyticsData } from '../types/conversion-analytics.types';
import type { OrgMember } from '../types/shared';
import { ConversionByCadenceTable } from './ConversionByCadenceTable';
import { ConversionFunnelChart } from './ConversionFunnelChart';
import { PipelineVelocityCard } from './PipelineVelocityCard';
import { StageToStageCards } from './StageToStageCards';
import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import type { CadenceOption } from '@/shared/components/AnalyticsFilters';

interface ConversionAnalyticsViewProps {
  data: ConversionAnalyticsData;
  members: OrgMember[];
  cadences?: CadenceOption[];
  hideFilters?: boolean;
  previousData?: ConversionAnalyticsData;
}

export function ConversionAnalyticsView({ data, members, cadences, hideFilters, previousData }: ConversionAnalyticsViewProps) {
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
        <ConversionFunnelChart stages={data.funnel} />
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
    </div>
  );
}
