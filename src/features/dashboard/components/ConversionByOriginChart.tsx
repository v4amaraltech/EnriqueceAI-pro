'use client';

import { useEffect, useState, useTransition } from 'react';

import { Loader2, Maximize2 } from 'lucide-react';
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
import { CANAL_OPTIONS } from '@/features/leads/schemas/lead.schemas';

import { getInsightsData } from '../actions/get-insights-data';
import type { ConversionByOriginEntry, DashboardFilters } from '../types';

interface ConversionByOriginChartProps {
  data: ConversionByOriginEntry[];
  filters?: DashboardFilters;
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
        {/* Legend removed per design request */}
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

export function ConversionByOriginChart({ data: initialData, filters }: ConversionByOriginChartProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedOrigin, setSelectedOrigin] = useState('');
  const [subOriginOpen, setSubOriginOpen] = useState(false);
  const [selectedSubOrigins, setSelectedSubOrigins] = useState<string[]>([]);
  const [data, setData] = useState<ConversionByOriginEntry[]>(initialData);
  const [isLoading, startTransition] = useTransition();

  // Sync data when initial data changes (e.g., when filters change at parent level)
  useEffect(() => { setData(initialData); }, [initialData]);

  // Refetch when sub-origins change
  useEffect(() => {
    if (!filters || selectedSubOrigins.length === 0) {
      setData(initialData);
      return;
    }
    startTransition(async () => {
      const result = await getInsightsData({ ...filters, subOrigins: selectedSubOrigins });
      if (result.success) setData(result.data.conversionByOrigin);
    });
  }, [selectedSubOrigins, filters, initialData]);

  const filteredData = selectedOrigin ? data.filter((d) => d.origin === selectedOrigin) : data;

  function toggleSubOrigin(canal: string) {
    setSelectedSubOrigins((prev) =>
      prev.includes(canal) ? prev.filter((s) => s !== canal) : [...prev, canal],
    );
  }

  const subOriginLabel = selectedSubOrigins.length === 0
    ? 'Todas sub-origens'
    : selectedSubOrigins.length === 1
      ? selectedSubOrigins[0]
      : `${selectedSubOrigins.length} sub-origens`;

  const subOriginPicker = filters && (
    <div className="relative">
      <button
        type="button"
        onClick={() => setSubOriginOpen((s) => !s)}
        className="h-7 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
      >
        {subOriginLabel} ▾
      </button>
      {subOriginOpen && (
        <div className="absolute right-0 top-8 z-10 max-h-64 w-48 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
          <button
            type="button"
            onClick={() => { setSelectedSubOrigins([]); setSubOriginOpen(false); }}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            Limpar seleção
          </button>
          <div className="my-1 border-t border-[var(--border)]" />
          {CANAL_OPTIONS.map((canal) => (
            <label key={canal} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--accent)]">
              <input
                type="checkbox"
                checked={selectedSubOrigins.includes(canal)}
                onChange={() => toggleSubOrigin(canal)}
                className="h-3 w-3"
              />
              {canal}
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="rounded-lg border bg-card p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">
            Conversão por Origem
            {isLoading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
          </h3>
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
            {subOriginPicker}
            {data.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
                title="Expandir"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-[350px]">
          {data.length === 0 ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Sem dados de conversão por origem
              </p>
            </div>
          ) : (
            <ConversionBarChart data={filteredData} height={420} />
          )}
        </div>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[90vw]">
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
