'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { SdrActivityComparisonEntry } from '../types/performance-analytics.types';

interface SdrActivityComparisonChartProps {
  data: SdrActivityComparisonEntry[];
}

export function SdrActivityComparisonChart({ data }: SdrActivityComparisonChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum dado de atividade no período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="userEmail"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={50}
        />
        <YAxis tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--foreground)',
          }}
          formatter={((value: number) => [value, 'Atividades']) as never}
        />
        <Bar dataKey="activities" fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
