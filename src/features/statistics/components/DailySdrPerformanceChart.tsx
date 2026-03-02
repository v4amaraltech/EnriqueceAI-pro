'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_SERIES_COLORS } from '@/shared/constants/chart-colors';

import type { DailySdrPerformanceEntry } from '../types/performance-analytics.types';

interface DailySdrPerformanceChartProps {
  data: DailySdrPerformanceEntry[];
  sdrKeys: string[];
}

export function DailySdrPerformanceChart({ data, sdrKeys }: DailySdrPerformanceChartProps) {
  if (data.length === 0 || sdrKeys.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum dado de tendência no período.
      </div>
    );
  }

  const interval = data.length > 30 ? Math.floor(data.length / 10) : data.length > 14 ? 2 : 0;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          interval={interval}
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
        />
        <Legend />
        {sdrKeys.map((sdr, index) => (
          <Line
            key={sdr}
            type="monotone"
            dataKey={sdr}
            name={sdr}
            stroke={CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
