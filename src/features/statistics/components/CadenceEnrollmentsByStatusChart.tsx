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

import { ENROLLMENT_STATUS_COLORS, ENROLLMENT_STATUS_LABELS } from '@/shared/constants/chart-colors';

import type { EnrollmentsByStatusEntry } from '../types/cadence-analytics.types';

interface CadenceEnrollmentsByStatusChartProps {
  data: EnrollmentsByStatusEntry[];
}

const statuses = ['active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed'] as const;

export function CadenceEnrollmentsByStatusChart({ data }: CadenceEnrollmentsByStatusChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum dado de inscrição no período.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="cadenceName"
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={60}
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
        />
        <Legend />
        {statuses.map((status) => (
          <Bar
            key={status}
            dataKey={status}
            name={ENROLLMENT_STATUS_LABELS[status] ?? status}
            stackId="stack"
            fill={ENROLLMENT_STATUS_COLORS[status]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
