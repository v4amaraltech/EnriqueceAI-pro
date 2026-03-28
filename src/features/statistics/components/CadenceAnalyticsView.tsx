'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { CadenceAnalyticsData, CadenceConversionRow, CadenceDistributionRow } from '../types/cadence-analytics.types';

function ConversionBar({ row }: { row: CadenceConversionRow }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-[240px] shrink-0 text-right text-sm truncate" title={row.cadenceName}>
        {row.cadenceName}
      </div>
      <div className="flex-1 flex h-8 rounded overflow-hidden">
        {row.wonPercent > 0 && (
          <div
            className="bg-green-500 flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${row.wonPercent}%` }}
          >
            {row.wonPercent >= 10 ? `${row.wonPercent.toFixed(0)}%` : ''}
          </div>
        )}
        {row.lostPercent > 0 && (
          <div
            className="bg-[#E53935] flex items-center justify-center text-white text-xs font-medium"
            style={{ width: `${row.lostPercent}%` }}
          >
            {row.lostPercent >= 10 ? `${row.lostPercent.toFixed(0)}%` : ''}
          </div>
        )}
      </div>
      <div className="w-[60px] shrink-0 text-right text-sm font-semibold">
        {row.totalLeads}
        <span className="text-xs text-[var(--muted-foreground)] font-normal ml-0.5">leads</span>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: '#3b82f6',
  paused: '#f59e0b',
  completed: '#22c55e',
  replied: '#06b6d4',
  bounced: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluído',
  replied: 'Respondeu',
  bounced: 'Bounced',
};

function DistributionBar({ row }: { row: CadenceDistributionRow }) {
  const total = row.totalLeads;
  if (total === 0) return null;

  const segments = [
    { key: 'active', count: row.active },
    { key: 'paused', count: row.paused },
    { key: 'completed', count: row.completed },
    { key: 'replied', count: row.replied },
    { key: 'bounced', count: row.bounced },
  ].filter((s) => s.count > 0);

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-[240px] shrink-0 text-right text-sm truncate" title={row.cadenceName}>
        {row.cadenceName}
      </div>
      <div className="flex-1 flex h-8 rounded overflow-hidden">
        {segments.map((seg) => (
          <div
            key={seg.key}
            style={{ width: `${(seg.count / total) * 100}%`, backgroundColor: STATUS_COLORS[seg.key] }}
            className="flex items-center justify-center text-white text-xs font-medium"
            title={`${STATUS_LABELS[seg.key]}: ${seg.count}`}
          >
            {seg.count / total >= 0.1 ? seg.count : ''}
          </div>
        ))}
      </div>
      <div className="w-[60px] shrink-0 text-right text-sm font-semibold">
        {row.totalLeads}
        <span className="text-xs text-[var(--muted-foreground)] font-normal ml-0.5">leads</span>
      </div>
    </div>
  );
}

interface CadenceAnalyticsViewProps {
  data: CadenceAnalyticsData;
}

export function CadenceAnalyticsView({ data }: CadenceAnalyticsViewProps) {
  const [tab, setTab] = useState<'conversion' | 'distribution'>('conversion');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Distribuição dos Leads nas Cadências</h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'conversion' | 'distribution')}>
        <TabsList>
          <TabsTrigger value="conversion">Taxa de Conversão</TabsTrigger>
          <TabsTrigger value="distribution">Distribuição dos Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="conversion" className="mt-6">
          {data.conversionRows.length > 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 divide-y divide-[var(--border)]">
              {data.conversionRows.map((row) => (
                <ConversionBar key={row.cadenceId} row={row} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
              Nenhuma cadência com leads no período.
            </p>
          )}
        </TabsContent>

        <TabsContent value="distribution" className="mt-6">
          {data.distributionRows.length > 0 ? (
            <>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 divide-y divide-[var(--border)]">
                {data.distributionRows.map((row) => (
                  <DistributionBar key={row.cadenceId} row={row} />
                ))}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-4 mt-4">
                {Object.entries(STATUS_COLORS).map(([key, color]) => (
                  <div key={key} className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
                    {STATUS_LABELS[key]}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
              Nenhuma cadência com leads no período.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
