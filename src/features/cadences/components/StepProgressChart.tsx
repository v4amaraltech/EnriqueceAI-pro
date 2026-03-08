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

import type { StepPerformanceMetrics } from '../cadences.contract';

interface StepProgressChartProps {
  steps: StepPerformanceMetrics[];
}

export function StepProgressChart({ steps }: StepProgressChartProps) {
  if (steps.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Nenhuma etapa com dados.
      </div>
    );
  }

  const data = steps.map((s) => ({
    name: s.activityName ?? `Etapa ${s.stepOrder}`,
    Executadas: s.sent,
    Pendentes: s.pending,
  }));

  const height = Math.max(250, steps.length * 60);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20, top: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
        <XAxis type="number" fontSize={12} />
        <YAxis type="category" dataKey="name" width={140} fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Legend iconType="circle" />
        <Bar dataKey="Executadas" stackId="progress" fill="#22c55e" radius={[0, 0, 0, 0]} barSize={20} />
        <Bar dataKey="Pendentes" stackId="progress" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
