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

interface StepRatesBarChartProps {
  steps: StepPerformanceMetrics[];
}

export function StepRatesBarChart({ steps }: StepRatesBarChartProps) {
  if (steps.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma etapa com dados.
      </div>
    );
  }

  const data = steps.map((s) => ({
    name: s.activityName ?? `Etapa ${s.stepOrder}`,
    Abertura: s.openRate,
    Resposta: s.replyRate,
    Bounce: s.bounceRate,
  }));

  const height = Math.max(250, steps.length * 60);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20, top: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} fontSize={12} />
        <YAxis type="category" dataKey="name" width={140} fontSize={12} />
        <Tooltip
          formatter={((value: number) => `${value}%`) as never}
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Legend iconType="circle" />
        <Bar dataKey="Abertura" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={14} />
        <Bar dataKey="Resposta" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={14} />
        <Bar dataKey="Bounce" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}
