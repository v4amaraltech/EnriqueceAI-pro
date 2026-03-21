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

import type { ChannelVolumeEntry } from '../types/activity-analytics.types';

interface ChannelVolumeChartProps {
  data: ChannelVolumeEntry[];
}

export function ChannelVolumeChart({ data }: ChannelVolumeChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma atividade no período.
      </div>
    );
  }

  // Transform for stacked bar: single entry with each channel as a key
  const chartData = [
    data.reduce(
      (acc, entry) => {
        acc[entry.label] = entry.count;
        return acc;
      },
      { name: 'Volume' } as Record<string, string | number>,
    ),
  ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
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
        {data.map((entry, idx) => (
          <Bar
            key={entry.channel}
            dataKey={entry.label}
            stackId="a"
            fill={entry.color}
            radius={idx === data.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
