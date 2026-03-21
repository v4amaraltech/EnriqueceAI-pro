'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { ActivityTypeEntry } from '../types/activity-analytics.types';

interface ActivityTypeDonutChartProps {
  data: ActivityTypeEntry[];
}

export function ActivityTypeDonutChart({ data }: ActivityTypeDonutChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma atividade no período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.type} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={((value: number, name: string) => {
            const entry = data.find((d) => d.label === name);
            return [`${value} (${entry?.percentage ?? 0}%)`, name];
          }) as never}
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
