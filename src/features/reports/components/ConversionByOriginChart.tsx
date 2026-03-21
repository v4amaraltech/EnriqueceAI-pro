'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { ConversionByOriginStat } from '../services/statistics.service';

interface ConversionByOriginChartProps {
  data: ConversionByOriginStat[];
  memberNames: Map<string, string>;
}

export function ConversionByOriginChart({ data, memberNames }: ConversionByOriginChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum dado de conversão no período.
      </div>
    );
  }

  const chartData = data.map((d) => {
    const label = memberNames.get(d.origin) ?? d.origin.slice(0, 8);
    return {
      name: label,
      Convertidos: d.qualified,
      Perdidos: d.unqualified,
      rate: d.conversionRate,
    };
  });

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="Convertidos" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Perdidos" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
