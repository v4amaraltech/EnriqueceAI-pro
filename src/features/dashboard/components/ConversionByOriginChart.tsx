'use client';

import { useState } from 'react';

import { Maximize2 } from 'lucide-react';
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

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import type { ConversionByOriginEntry } from '../types';

interface ConversionByOriginChartProps {
  data: ConversionByOriginEntry[];
}

function ConversionBarChart({ data, height }: { data: ConversionByOriginEntry[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
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
          fillOpacity={0.6}
          stackId="stack"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="lost"
          name="Perdidos"
          fill="var(--destructive)"
          fillOpacity={0.6}
          stackId="stack"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ConversionByOriginChart({ data }: ConversionByOriginChartProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedOrigin, setSelectedOrigin] = useState('');
  const filteredData = selectedOrigin ? data.filter((d) => d.origin === selectedOrigin) : data;

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
    <>
      <div className="rounded-lg border bg-card p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">Conversão por Origem</h3>
          <div className="flex items-center gap-2">
            <select
              value={selectedOrigin}
              onChange={(e) => setSelectedOrigin(e.target.value)}
              className="h-7 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
            >
              <option value="">Todas origens</option>
              {data.map((d) => (
                <option key={d.origin} value={d.origin}>{d.origin}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
              title="Expandir"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-[350px]">
          <ConversionBarChart data={filteredData} height={420} />
        </div>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Conversão por Origem</DialogTitle>
          </DialogHeader>
          <div className="min-h-[500px]">
            <ConversionBarChart data={data} height={500} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
