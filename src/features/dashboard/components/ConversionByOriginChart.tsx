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

import type { ConversionByOriginEntry } from '../types';

interface ConversionByOriginChartProps {
  data: ConversionByOriginEntry[];
}

export function ConversionByOriginChart({ data }: ConversionByOriginChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-card">
        <p className="text-sm text-muted-foreground">
          Sem dados de conversão por origem
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col">
      <h3 className="mb-4 text-sm font-medium">
        Conversão por Origem
      </h3>
      <div className="flex-1 min-h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          />
          <YAxis
            type="category"
            dataKey="origin"
            width={140}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          />
          <Tooltip
            cursor={false}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--foreground)',
            }}
          />
          <Legend />
          <Bar
            dataKey="converted"
            name="Convertidos"
            fill="#22c55e"
            fillOpacity={0.8}
            stackId="stack"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="lost"
            name="Perdidos"
            fill="var(--destructive)"
            fillOpacity={0.8}
            stackId="stack"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
