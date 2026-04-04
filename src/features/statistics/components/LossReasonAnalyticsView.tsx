'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type {
  LossByCadenceStackedRow,
  LossByUserStackedRow,
  LossReasonAnalyticsData,
  LossReasonEntry,
} from '../types/loss-reason-analytics.types';

/* ── Shared: stacked bar + legend ─────────────────────────── */

interface StackedRow {
  id: string;
  label: string;
  totalLost: number;
  reasons: Array<{ reasonName: string; count: number; color: string }>;
}

function StackedBar({ row }: { row: StackedRow }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-[240px] shrink-0 text-right text-sm truncate" title={row.label}>
        {row.label}
      </div>
      <div className="flex-1 flex h-8 rounded-sm overflow-hidden">
        {row.reasons.map((r, i) => (
          <div
            key={i}
            style={{ width: `${(r.count / row.totalLost) * 100}%`, backgroundColor: r.color }}
            className="h-full min-w-[2px]"
            title={`${r.reasonName}: ${r.count}`}
          />
        ))}
      </div>
      <div className="w-[60px] shrink-0 text-right">
        <span className="text-sm font-semibold">{row.totalLost}</span>
        <span className="text-xs text-[var(--muted-foreground)] block leading-tight">perdas</span>
      </div>
    </div>
  );
}

function StackedChartWithLegend({ rows, emptyMessage }: { rows: StackedRow[]; emptyMessage: string }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
        {emptyMessage}
      </p>
    );
  }

  // Build legend from all reasons across all rows
  const legendMap = new Map<string, string>();
  for (const row of rows) {
    for (const r of row.reasons) {
      if (!legendMap.has(r.reasonName)) legendMap.set(r.reasonName, r.color);
    }
  }

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0">
        {rows.map((row) => (
          <StackedBar key={row.id} row={row} />
        ))}
      </div>
      <div className="w-[220px] shrink-0 flex flex-col gap-1.5 pt-2">
        {Array.from(legendMap.entries()).map(([name, color]) => (
          <div key={name} className="flex items-center gap-2 text-xs">
            <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="truncate" title={name}>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── By Reason (horizontal bars) ──────────────────────────── */

function ReasonBar({ entry, maxCount }: { entry: LossReasonEntry; maxCount: number }) {
  const widthPercent = maxCount > 0 ? (entry.count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-[220px] shrink-0 text-right text-sm truncate" title={entry.reasonName}>
        {entry.reasonName}
      </div>
      <div className="relative flex-1 h-8">
        <div className="absolute inset-0 flex">
          {[0, 25, 50, 75, 100].map((pct) => (
            <div key={pct} className="absolute h-full border-l border-[var(--border)]" style={{ left: `${pct}%` }} />
          ))}
        </div>
        <div
          className="relative h-full rounded-sm bg-[var(--border)]"
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      <span className="w-[45px] shrink-0 text-sm font-semibold">{entry.percentage.toFixed(0)}%</span>
    </div>
  );
}

function ByReasonTab({ data }: { data: LossReasonEntry[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
        Nenhum motivo de perda no período.
      </p>
    );
  }
  const maxCount = Math.max(...data.map((d) => d.count));
  return (
    <div>
      {data.map((entry) => (
        <ReasonBar key={entry.reasonId} entry={entry} maxCount={maxCount} />
      ))}
    </div>
  );
}

/* ── By Cadence (stacked bars) ────────────────────────────── */

function ByCadenceTab({ data }: { data: LossByCadenceStackedRow[] }) {
  const rows: StackedRow[] = data.map((d) => ({
    id: d.cadenceId,
    label: d.cadenceName,
    totalLost: d.totalLost,
    reasons: d.reasons,
  }));
  return <StackedChartWithLegend rows={rows} emptyMessage="Nenhuma perda por cadência no período." />;
}

/* ── By User (stacked bars) ───────────────────────────────── */

function ByUserTab({ data }: { data: LossByUserStackedRow[] }) {
  const rows: StackedRow[] = data.map((d) => ({
    id: d.userId,
    label: d.userName,
    totalLost: d.totalLost,
    reasons: d.reasons,
  }));
  return <StackedChartWithLegend rows={rows} emptyMessage="Nenhuma perda por usuário no período." />;
}

/* ── By Team (aggregate stacked bar) ──────────────────────── */

function ByTeamTab({ data }: { data: LossByUserStackedRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
        Nenhuma perda no período.
      </p>
    );
  }

  // Aggregate all users into a single "Team" row
  const reasonTotals = new Map<string, { count: number; color: string }>();
  let totalLost = 0;
  for (const user of data) {
    totalLost += user.totalLost;
    for (const r of user.reasons) {
      const existing = reasonTotals.get(r.reasonName);
      if (existing) {
        existing.count += r.count;
      } else {
        reasonTotals.set(r.reasonName, { count: r.count, color: r.color });
      }
    }
  }

  const teamRow: StackedRow = {
    id: 'team',
    label: 'Time completo',
    totalLost,
    reasons: Array.from(reasonTotals.entries())
      .map(([reasonName, { count, color }]) => ({ reasonName, count, color }))
      .sort((a, b) => b.count - a.count),
  };

  return <StackedChartWithLegend rows={[teamRow]} emptyMessage="Nenhuma perda no período." />;
}

/* ── Main view ────────────────────────────────────────────── */

interface LossReasonAnalyticsViewProps {
  data: LossReasonAnalyticsData;
}

export function LossReasonAnalyticsView({ data }: LossReasonAnalyticsViewProps) {
  const [tab, setTab] = useState<'reason' | 'user' | 'team' | 'cadence'>('reason');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Por quais motivos os leads estão sendo perdidos?</h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList variant="line">
          <TabsTrigger value="reason">Por motivo</TabsTrigger>
          <TabsTrigger value="user">Por usuário</TabsTrigger>
          <TabsTrigger value="team">Por time</TabsTrigger>
          <TabsTrigger value="cadence">Por cadência</TabsTrigger>
        </TabsList>

        <TabsContent value="reason" className="mt-6">
          <ByReasonTab data={data.reasonsRanking} />
        </TabsContent>

        <TabsContent value="user" className="mt-6">
          <ByUserTab data={data.lossByUserStacked} />
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <ByTeamTab data={data.lossByUserStacked} />
        </TabsContent>

        <TabsContent value="cadence" className="mt-6">
          <ByCadenceTab data={data.lossByCadenceStacked} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
