'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { LossReasonEntry } from '../types/loss-reason-analytics.types';

interface LossReasonsBarChartProps {
  data: LossReasonEntry[];
}

export function LossReasonsBarChart({ data }: LossReasonsBarChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhum motivo de perda no período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 45)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 40, bottom: 5, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="reasonName"
          width={150}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--foreground)',
          }}
          formatter={((value: number, _name: string, props: { payload: LossReasonEntry }) =>
            [`${value} (${props.payload.percentage}%)`, 'Perdas']
          ) as never}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell key={entry.reasonId} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
