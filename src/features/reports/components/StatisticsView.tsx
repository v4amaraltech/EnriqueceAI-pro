'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { DateRangePicker } from '@/shared/components/DateRangePicker';
import { useDateRange } from '@/shared/hooks/useDateRange';

import type { StatisticsData } from '../services/statistics.service';
import { ConversionByOriginChart } from './ConversionByOriginChart';
import { LossReasonsChart } from './LossReasonsChart';
import { ResponseTimeSection } from './ResponseTimeSection';
import { TimeIntervalModal } from './TimeIntervalModal';

interface StatisticsViewProps {
  data: StatisticsData;
  members: { userId: string; email: string; name?: string }[];
}

export function StatisticsView({ data, members }: StatisticsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [intervalModalOpen, setIntervalModalOpen] = useState(false);
  const { from, to, setRange } = useDateRange('/statistics');

  const currentUser = searchParams.get('user') ?? '';
  const currentThreshold = parseInt(searchParams.get('threshold') ?? '60', 10);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === '' || (key === 'threshold' && value === '60')) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      startTransition(() => {
        router.push(`/statistics?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition],
  );

  const memberNames = new Map(members.map((m) => [m.userId, m.name ?? m.email.split('@')[0] ?? m.email]));

  return (
    <div className={`space-y-6 ${isPending ? 'opacity-70' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Estatísticas</h1>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Insights de motivos de perda, conversão e tempo de resposta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker from={from} to={to} onChange={setRange} />
          {/* User filter */}
          <select
            value={currentUser}
            onChange={(e) => updateParams({ user: e.target.value || undefined })}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
          >
            <option value="">Todos os vendedores</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.email.split('@')[0]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Loss Reasons */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Motivos de Perda</h2>
          <LossReasonsChart data={data.lossReasons} />
        </div>

        {/* Conversion by Origin */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Conversão por Origem</h2>
          <ConversionByOriginChart data={data.conversionByOrigin} memberNames={memberNames} />
        </div>
      </div>

      {/* Response Time (full width) */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Tempo de Resposta</h2>
        <ResponseTimeSection
          data={data.responseTime}
          onOpenIntervalModal={() => setIntervalModalOpen(true)}
        />
      </div>

      {/* Interval Modal */}
      <TimeIntervalModal
        open={intervalModalOpen}
        onOpenChange={setIntervalModalOpen}
        currentMinutes={currentThreshold}
        onConfirm={(minutes) => updateParams({ threshold: String(minutes) })}
      />
    </div>
  );
}
