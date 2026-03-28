'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { LossReasonStat } from '../services/statistics.service';

interface LossReasonsChartProps {
  data: LossReasonStat[];
}

export function LossReasonsChart({ data }: LossReasonsChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum motivo de perda registrado no período.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.reasonName.length > 25 ? d.reasonName.slice(0, 25) + '…' : d.reasonName,
    fullName: d.reasonName,
    count: d.count,
    percentage: d.percentage,
  }));

  // Dynamic height: min 200px, scales with number of items (50px per bar)
  const chartHeight = Math.max(200, chartData.length * 50 + 40);

  return (
    <div style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={((value: number, _name: string, props: { payload: { percentage?: number } }) => {
              const pct = props.payload?.percentage;
              return [`${value}${pct ? ` (${pct.toFixed(0)}%)` : ''}`, 'Leads'];
            }) as never}
          />
          <Bar dataKey="count" fill="var(--destructive)" radius={[0, 4, 4, 0]} barSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
