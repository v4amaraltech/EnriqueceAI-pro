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

import { INTERACTION_TYPE_COLORS } from '@/shared/constants/chart-colors';

import type { DailyEmailTrendEntry } from '../types/email-analytics.types';

interface DailyEmailTrendChartProps {
  data: DailyEmailTrendEntry[];
}

export function DailyEmailTrendChart({ data }: DailyEmailTrendChartProps) {
  const hasData = data.some((d) => d.sent > 0 || d.opened > 0 || d.replied > 0);

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum dado de e-mail no período.
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
        <Line
          type="monotone"
          dataKey="sent"
          name="Enviados"
          stroke={INTERACTION_TYPE_COLORS.sent}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="opened"
          name="Abertos"
          stroke={INTERACTION_TYPE_COLORS.opened}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="replied"
          name="Respondidos"
          stroke={INTERACTION_TYPE_COLORS.replied}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
