'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { INTERACTION_TYPE_COLORS } from '@/shared/constants/chart-colors';

import type { DailyBounceTrendEntry } from '../types/email-analytics.types';

interface BounceRateTrendChartProps {
  data: DailyBounceTrendEntry[];
}

export function BounceRateTrendChart({ data }: BounceRateTrendChartProps) {
  const hasData = data.some((d) => d.bounced > 0);

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum bounce no período.
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
        <Line
          type="monotone"
          dataKey="bounced"
          name="Bounces"
          stroke={INTERACTION_TYPE_COLORS.bounced}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
