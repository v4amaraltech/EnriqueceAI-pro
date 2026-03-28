'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { LossReasonAnalyticsData, LossReasonEntry, LossByCadenceStackedRow } from '../types/loss-reason-analytics.types';

function ReasonBar({ entry, maxCount }: { entry: LossReasonEntry; maxCount: number }) {
  const widthPercent = maxCount > 0 ? (entry.count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-[200px] shrink-0 text-right text-sm truncate" title={entry.reasonName}>
        {entry.reasonName}
      </div>
      <div className="flex-1 h-7 bg-[var(--muted)]/50 rounded overflow-hidden">
        <div className="h-full bg-[var(--muted-foreground)]/30 rounded" style={{ width: `${widthPercent}%` }} />
      </div>
      <span className="w-[50px] shrink-0 text-sm font-semibold text-right">{entry.percentage.toFixed(0)}%</span>
    </div>
  );
}

function ByReasonTab({ data }: { data: LossReasonEntry[] }) {
  if (data.length === 0) return <p className="text-sm text-[var(--muted-foreground)] text-center py-8">Nenhum motivo de perda no período.</p>;
  const maxCount = Math.max(...data.map((d) => d.count));
  return (
    <div className="divide-y divide-[var(--border)]">
      {data.map((entry) => <ReasonBar key={entry.reasonId} entry={entry} maxCount={maxCount} />)}
    </div>
  );
}

function CadenceStackedBar({ row }: { row: LossByCadenceStackedRow }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-[220px] shrink-0 text-right text-sm truncate" title={row.cadenceName}>{row.cadenceName}</div>
      <div className="flex-1 flex h-8 rounded overflow-hidden">
        {row.reasons.map((r, i) => (
          <div key={i} style={{ width: `${(r.count / row.totalLost) * 100}%`, backgroundColor: r.color }}
            className="flex items-center justify-center text-white text-[10px] font-medium" title={`${r.reasonName}: ${r.count}`} />
        ))}
      </div>
      <div className="w-[60px] shrink-0 text-right text-sm font-semibold">
        {row.totalLost}<span className="text-xs text-[var(--muted-foreground)] font-normal ml-0.5">perdas</span>
      </div>
    </div>
  );
}

function ByCadenceTab({ data }: { data: LossByCadenceStackedRow[] }) {
  if (data.length === 0) return <p className="text-sm text-[var(--muted-foreground)] text-center py-8">Nenhuma perda por cadência no período.</p>;
  const legendMap = new Map<string, string>();
  for (const row of data) for (const r of row.reasons) if (!legendMap.has(r.reasonName)) legendMap.set(r.reasonName, r.color);
  return (
    <>
      <div className="divide-y divide-[var(--border)]">
        {data.map((row) => <CadenceStackedBar key={row.cadenceId} row={row} />)}
      </div>
      <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-[var(--border)]">
        {Array.from(legendMap.entries()).map(([name, color]) => (
          <div key={name} className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />{name}
          </div>
        ))}
      </div>
    </>
  );
}

interface LossReasonAnalyticsViewProps { data: LossReasonAnalyticsData }

export function LossReasonAnalyticsView({ data }: LossReasonAnalyticsViewProps) {
  const [tab, setTab] = useState<'reason' | 'cadence'>('reason');
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Por quais motivos os leads estão sendo perdidos?</h1></div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'reason' | 'cadence')}>
        <TabsList>
          <TabsTrigger value="reason">Por motivo</TabsTrigger>
          <TabsTrigger value="cadence">Por cadência</TabsTrigger>
        </TabsList>
        <TabsContent value="reason" className="mt-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <ByReasonTab data={data.reasonsRanking} />
          </div>
        </TabsContent>
        <TabsContent value="cadence" className="mt-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <ByCadenceTab data={data.lossByCadenceStacked} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
