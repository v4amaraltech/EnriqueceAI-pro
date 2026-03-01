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

import type { DailyDataPoint } from '../types';

interface OpportunityChartProps {
  data: DailyDataPoint[];
  currentDay: number;
}

export function OpportunityChart({ data, currentDay }: OpportunityChartProps) {
  // Only show data up to current day for "actual" line
  const chartData = data.map((point) => ({
    ...point,
    actual: point.day <= currentDay ? point.actual : null,
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-card">
        <p className="text-sm text-muted-foreground">
          Sem dados para exibir o gráfico
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">
        Oportunidades acumuladas vs Meta
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 12, fill: 'var(--foreground)' }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--foreground)' }}
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
          />
          <Legend wrapperStyle={{ color: 'var(--foreground)' }} />
          <Line
            type="monotone"
            dataKey="actual"
            name="Realizado"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="target"
            name="Meta"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            strokeOpacity={0.5}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
