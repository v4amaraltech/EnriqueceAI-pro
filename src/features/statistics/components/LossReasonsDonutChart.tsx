'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { LossReasonEntry } from '../types/loss-reason-analytics.types';

interface LossReasonsDonutChartProps {
  data: LossReasonEntry[];
}

export function LossReasonsDonutChart({ data }: LossReasonsDonutChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum motivo de perda no período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="reasonName"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.reasonId} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--foreground)',
          }}
          formatter={((value: number, name: string) => [`${value} (${data.find((d) => d.reasonName === name)?.percentage ?? 0}%)`, name]) as never}
        />
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          formatter={(value: string) => (
            <span className="text-xs text-[var(--foreground)]">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
