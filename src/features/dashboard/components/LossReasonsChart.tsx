'use client';

import { useState } from 'react';

import { Maximize2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import type { LossReasonEntry } from '../types';

interface LossReasonsChartProps {
  data: LossReasonEntry[];
}

function LossReasonsBarChart({ data, height }: { data: LossReasonEntry[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 40, bottom: 5, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
        />
        <YAxis
          type="category"
          dataKey="reason"
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          width={160}
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
          formatter={((value: number, _name: string, props: { payload: LossReasonEntry }) =>
            [`${value} (${props.payload.percent}%)`, 'Perdas']
          ) as never}
        />
        <Bar
          dataKey="count"
          fill="var(--destructive)"
          fillOpacity={0.6}
          radius={[0, 4, 4, 0]}
          barSize={32}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LossReasonsChart({ data }: LossReasonsChartProps) {
  const [expanded, setExpanded] = useState(false);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-card">
        <p className="text-sm text-muted-foreground">
          Sem dados de motivos de perda
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border bg-card p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">Motivos de Perda</h3>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
            title="Expandir"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 min-h-[350px]">
          <LossReasonsBarChart data={data} height={420} />
        </div>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>Motivos de Perda</DialogTitle>
          </DialogHeader>
          <div className="min-h-[500px]">
            <LossReasonsBarChart data={data} height={500} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
