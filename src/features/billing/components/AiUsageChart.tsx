'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AiDailyUsage } from '../types';

interface AiUsageChartProps {
  data: AiDailyUsage[];
  dailyLimit: number; // -1 = unlimited
}

function formatDateLabel(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

export function AiUsageChart({ data, dailyLimit }: AiUsageChartProps) {
  const hasData = data.some((d) => d.count > 0);

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum uso de IA nos últimos 30 dias.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    label: formatDateLabel(d.date),
    count: d.count,
  }));

  const interval = data.length > 14 ? 2 : 0;
  const showLimit = dailyLimit > 0;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
          formatter={(value: number | undefined) => [value ?? 0, 'Gerações']}
        />
        <Line
          type="monotone"
          dataKey="count"
          name="Gerações IA"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
        />
        {showLimit && (
          <ReferenceLine
            y={dailyLimit}
            stroke="var(--destructive)"
            strokeDasharray="4 4"
            label={{
              value: `Limite: ${dailyLimit}`,
              position: 'insideTopRight',
              fill: 'var(--destructive)',
              fontSize: 11,
            }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
