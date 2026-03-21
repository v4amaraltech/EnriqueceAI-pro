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

import { CHART_ACCENT } from '@/shared/constants/chart-colors';

import type { DailyActivityEntry } from '../types/activity-analytics.types';

interface DailyActivityTrendChartProps {
  data: DailyActivityEntry[];
}

export function DailyActivityTrendChart({ data }: DailyActivityTrendChartProps) {
  const hasData = data.some((d) => d.count > 0);

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma atividade no período.
      </div>
    );
  }

  // Show every nth label to avoid crowding
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
        <Line
          type="monotone"
          dataKey="count"
          name="Atividades"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="target"
          name="Meta"
          stroke={CHART_ACCENT.targetLine}
          strokeWidth={1.5}
          strokeDasharray="5 5"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
