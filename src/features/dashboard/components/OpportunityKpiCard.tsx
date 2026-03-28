'use client';

import { BarChart3, CalendarDays, HelpCircle, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';
import type { DailyDataPoint, OpportunityKpiData } from '../types';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const MONTH_ABBR = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

function getMonthName(month: string): string {
  const [, mon] = month.split('-').map(Number) as [number, number];
  return MONTH_NAMES[mon - 1] ?? month;
}

function getMonthAbbr(month: string): string {
  const [, mon] = month.split('-').map(Number) as [number, number];
  return MONTH_ABBR[mon - 1] ?? '';
}

function formatXAxis(day: number, daysInMonth: number, monthAbbr: string): string {
  if (day === 1) return `1. ${monthAbbr}`;
  if (day === Math.round(daysInMonth / 2)) return `${day}. ${monthAbbr}`;
  if (day === daysInMonth) return `${day}. ${monthAbbr}`;
  return '';
}

interface OpportunityKpiCardProps {
  kpi: OpportunityKpiData;
  month: string;
}

export function OpportunityKpiCard({ kpi, month }: OpportunityKpiCardProps) {
  const monthName = getMonthName(month);
  const monthNameLower = monthName.toLowerCase();
  const monthAbbr = getMonthAbbr(month);
  const isAbove = kpi.percentOfTarget >= 0;
  const absPercent = Math.abs(kpi.percentOfTarget);
  const expectedByNow = kpi.monthTarget > 0
    ? Math.round((kpi.monthTarget / kpi.daysInMonth) * kpi.currentDay)
    : 0;

  // Chart data — cumulative for line chart, show only up to current day
  const chartData = kpi.dailyData.map((point: DailyDataPoint) => ({
    day: point.day,
    target: point.target,
    actual: point.day <= kpi.currentDay ? point.actual : null,
  }));

  // Y-axis domain: proportional to target, with a small buffer
  const maxTarget = kpi.monthTarget > 0 ? kpi.monthTarget : 5;
  const maxActual = Math.max(...kpi.dailyData.map((d) => d.actual));
  const yMax = Math.max(maxTarget, maxActual) + 1;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-6 p-6 lg:flex-row lg:p-8">
        {/* Left column — Stats */}
        <div className="flex w-full shrink-0 flex-col justify-center lg:w-[400px] lg:pl-14">
          {/* Big number */}
          <p className="text-6xl font-bold tracking-tight text-foreground">{kpi.totalOpportunities}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-foreground/70">
            Oportunidades em {monthName}
            <span title="Leads convertidos em oportunidades no mês">
              <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
            </span>
          </p>

          {/* Meta row */}
          {kpi.monthTarget > 0 && (
            <div className="mt-6 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                <CalendarDays className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-sm leading-relaxed">
                Meta de oportunidades para {monthNameLower}:{' '}
                <span className="font-semibold text-emerald-600">{kpi.monthTarget}</span>
              </p>
            </div>
          )}

          {/* % indicator row — NO progress bar */}
          {kpi.monthTarget > 0 && (
            <div className="mt-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10">
                <BarChart3 className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-sm leading-relaxed">
                <span className={cn('inline-flex items-center gap-0.5 font-medium', isAbove ? 'text-emerald-600' : 'text-red-500')}>
                  {isAbove ? (
                    <TrendingUp className="inline h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="inline h-3.5 w-3.5" />
                  )}
                  {absPercent}% {isAbove ? 'acima' : 'abaixo'} do previsto até hoje ({expectedByNow})
                </span>
                {' '}
                <span className="text-foreground/60">para alcançar a meta mensal</span>
              </p>
            </div>
          )}

          {kpi.monthTarget === 0 && (
            <p className="mt-6 text-sm text-muted-foreground">
              Nenhuma meta definida para {monthNameLower}
            </p>
          )}
        </div>

        {/* Right column — Chart */}
        <div className="flex min-w-0 flex-1 items-center lg:max-w-[55%]">
          {kpi.dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: -15 }}>
                <defs>
                  <linearGradient id="gradientArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal={false} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(day: number) => formatXAxis(day, kpi.daysInMonth, monthAbbr)}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, yMax]}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: 'var(--foreground)',
                  }}
                  labelFormatter={(day) => `Dia ${day}`}
                  formatter={(value?: number, name?: string) => {
                    const v = value ?? 0;
                    const n = name ?? '';
                    if (n === 'Meta') return [Math.round(v), n];
                    if (v === null || v === undefined) return [null, null];
                    return [v, n];
                  }}
                  filterNull
                />
                {/* Meta line — gray diagonal showing expected pace */}
                <Line
                  type="linear"
                  dataKey="target"
                  name="Meta"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.5}
                  strokeOpacity={0.35}
                  strokeDasharray="6 3"
                  dot={false}
                  activeDot={false}
                />
                {/* Area fill under the green line */}
                <Area
                  type="monotone"
                  dataKey="actual"
                  fill="url(#gradientArea)"
                  stroke="none"
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Actual line — green with dots at each data point */}
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Oportunidades"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#22c55e', stroke: '#22c55e', strokeWidth: 1 }}
                  activeDot={{ r: 5, fill: '#22c55e', stroke: '#fff', strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] w-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Sem dados para exibir</p>
            </div>
          )}
        </div>
      </div>

      {/* Legend — below the chart area */}
      {kpi.dailyData.length > 0 && (
        <div className="flex items-center justify-center gap-6 border-t border-border px-6 py-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-xs text-muted-foreground">Oportunidades</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4 border-t border-dashed border-muted-foreground/40" />
            <span className="text-xs text-muted-foreground">Meta</span>
          </div>
        </div>
      )}
    </div>
  );
}
