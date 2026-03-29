'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { CadenceAnalyticsData, CadenceConversionRow, CadenceDistributionRow } from '../types/cadence-analytics.types';

function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

/* ── Conversion tab ── */

function ConversionBar({ row }: { row: CadenceConversionRow }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="w-[280px] shrink-0 text-right text-sm leading-snug pr-2" title={row.cadenceName}>
        {row.cadenceName}
      </div>
      <div className="flex-1 relative">
        <div className="flex h-10 rounded overflow-hidden w-full">
          {row.wonPercent > 0 && (
            <div
              className="bg-emerald-500 flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${row.wonPercent}%` }}
            >
              {row.wonPercent >= 8 ? `${row.wonPercent.toFixed(0)}%` : ''}
            </div>
          )}
          {row.lostPercent > 0 && (
            <div
              className="bg-[#E53935] flex items-center justify-center text-white text-xs font-medium transition-all"
              style={{ width: `${row.lostPercent}%` }}
            >
              {row.lostPercent >= 8 ? `${row.lostPercent.toFixed(0)}%` : ''}
            </div>
          )}
        </div>
      </div>
      <div className="w-[80px] shrink-0">
        <span className="text-base font-bold">{fmt(row.totalLeads)}</span>
        <br />
        <span className="text-xs text-[var(--muted-foreground)]">leads</span>
      </div>
    </div>
  );
}

/* ── Distribution tab ── */

const STATUS_COLORS: Record<string, string> = {
  active: '#3b82f6',
  paused: '#a78bfa',
  completed: '#22d3ee',
  replied: '#94a3b8',
  bounced: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluído',
  replied: 'Respondeu',
  bounced: 'Bounced',
};

function DistributionBar({ row, maxLeads }: { row: CadenceDistributionRow; maxLeads: number }) {
  const total = row.totalLeads;
  if (total === 0) return null;

  const barWidth = maxLeads > 0 ? (total / maxLeads) * 100 : 0;

  const segments = [
    { key: 'active', count: row.active },
    { key: 'completed', count: row.completed },
    { key: 'replied', count: row.replied },
    { key: 'paused', count: row.paused },
    { key: 'bounced', count: row.bounced },
  ].filter((s) => s.count > 0);

  return (
    <div className="flex items-center gap-4 py-4">
      <div className="w-[320px] shrink-0 text-right text-sm leading-snug pr-2" title={row.cadenceName}>
        {row.cadenceName}
      </div>
      <div className="flex-1 relative">
        <div className="flex h-10 rounded overflow-hidden" style={{ width: `${Math.max(barWidth, 2)}%` }}>
          {segments.map((seg) => (
            <div
              key={seg.key}
              style={{ width: `${(seg.count / total) * 100}%`, backgroundColor: STATUS_COLORS[seg.key] }}
              className="flex items-center justify-center text-white text-xs font-medium transition-all"
              title={`${STATUS_LABELS[seg.key]}: ${fmt(seg.count)}`}
            />
          ))}
        </div>
      </div>
      <div className="w-[80px] shrink-0">
        <span className="text-base font-bold">{fmt(total)}</span>
        <br />
        <span className="text-xs text-[var(--muted-foreground)]">leads</span>
      </div>
    </div>
  );
}

/* ── Main view ── */

interface CadenceAnalyticsViewProps {
  data: CadenceAnalyticsData;
}

export function CadenceAnalyticsView({ data }: CadenceAnalyticsViewProps) {
  const [tab, setTab] = useState<'conversion' | 'distribution'>('distribution');


  const distributionMax = data.distributionRows.reduce((max, r) => Math.max(max, r.totalLeads), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Distribuição dos Leads nas Cadências</h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'conversion' | 'distribution')}>
        <TabsList variant="line">
          <TabsTrigger value="conversion">Taxa de Conversão</TabsTrigger>
          <TabsTrigger value="distribution">Distribuição dos Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="conversion" className="mt-4">
          {data.conversionRows.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {data.conversionRows.map((row) => (
                <ConversionBar key={row.cadenceId} row={row} />
              ))}
              {/* Legend */}
              <div className="flex gap-6 pt-4">
                <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <div className="h-3 w-3 rounded-sm bg-emerald-500" />
                  Ganhos
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <div className="h-3 w-3 rounded-sm bg-[#E53935]" />
                  Perdidos
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
              Nenhuma cadência com leads no período.
            </p>
          )}
        </TabsContent>

        <TabsContent value="distribution" className="mt-4">
          {data.distributionRows.length > 0 ? (
            <div>
              <div className="divide-y divide-[var(--border)]">
                {data.distributionRows.map((row) => (
                  <DistributionBar key={row.cadenceId} row={row} maxLeads={distributionMax} />
                ))}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-[var(--border)]">
                {Object.entries(STATUS_COLORS).map(([key, color]) => (
                  <div key={key} className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                    <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
                    {STATUS_LABELS[key]}
                  </div>
                ))}
              </div>
            </div>
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
