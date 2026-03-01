'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_ACCENT } from '@/shared/constants/chart-colors';

import type { SdrCallEntry } from '../types/call-statistics.types';

interface CallsPerSdrChartProps {
  data: SdrCallEntry[];
}

export function CallsPerSdrChart({ data }: CallsPerSdrChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhuma ligação no período.
      </div>
    );
  }

  const chartData = data.map((entry) => ({
    name: entry.userName,
    'Total Ligações': entry.totalCalls,
    'Taxa Conexão (%)': entry.connectionRate,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          domain={[0, 100]}
          unit="%"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--foreground)',
          }}
        />
        <Legend />
        <Bar yAxisId="left" dataKey="Total Ligações" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        <Bar yAxisId="right" dataKey="Taxa Conexão (%)" fill={CHART_ACCENT.connectionRate} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
