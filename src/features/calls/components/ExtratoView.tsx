'use client';

import { useTransition } from 'react';

import { Clock, DollarSign, Download, Phone, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

import { MetricCard } from '@/features/dashboard/components/MetricCard';
import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import type { OrgMember } from '@/features/statistics/types/shared';
import { formatDuration, formatDurationLong } from '@/features/statistics/types/shared';
import { useDateRange } from '@/shared/hooks/useDateRange';
import { Button } from '@/shared/components/ui/button';

import { exportExtratoCsv } from '../actions/export-extrato-csv';
import type { ExtratoData } from '../types/extrato';

interface ExtratoViewProps {
  data: ExtratoData;
  members: OrgMember[];
  userId?: string;
}

export function ExtratoView({ data, members, userId }: ExtratoViewProps) {
  const [isPending, startTransition] = useTransition();
  const { from, to } = useDateRange('/calls/extrato');

  function handleExportCsv() {
    startTransition(async () => {
      const userIds = userId ? [userId] : undefined;
      const result = await exportExtratoCsv('30d', userIds, { from, to });
      if (result.success) {
        const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Extrato exportado com sucesso');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Extrato de Ligações</h1>
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Relatório de uso, custos e atividade de ligações.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AnalyticsFilters basePath="/calls/extrato" members={members} />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isPending}
          >
            <Download className="mr-1 h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total de Ligações"
          value={data.kpis.totalCalls}
          icon={Phone}
        />
        <MetricCard
          title="Duração Total"
          value={formatDurationLong(data.kpis.totalDurationSeconds)}
          icon={Clock}
        />
        <MetricCard
          title="Custo Total"
          value={`R$ ${data.kpis.totalCost.toFixed(2)}`}
          icon={DollarSign}
        />
        <MetricCard
          title="Média/Dia"
          value={data.kpis.avgCallsPerDay}
          icon={TrendingUp}
        />
      </div>

      {/* Daily breakdown table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-lg font-semibold">Extrato Diário</h2>
        </div>
        {data.dailyBreakdown.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhuma ligação no período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-[var(--muted)]/50">
                  <th className="p-3 text-left text-sm font-medium">Data</th>
                  <th className="p-3 text-right text-sm font-medium">Ligações</th>
                  <th className="p-3 text-right text-sm font-medium">Duração</th>
                  <th className="p-3 text-right text-sm font-medium">Significativas</th>
                  <th className="p-3 text-right text-sm font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyBreakdown.map((row) => (
                  <tr key={row.date} className="border-b last:border-0">
                    <td className="p-3 text-sm">
                      {new Date(row.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-3 text-right text-sm">{row.calls}</td>
                    <td className="p-3 text-right text-sm">{formatDuration(row.durationSeconds)}</td>
                    <td className="p-3 text-right text-sm">{row.significantCalls}</td>
                    <td className="p-3 text-right text-sm">R$ {row.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SDR breakdown table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-lg font-semibold">Por Vendedor</h2>
        </div>
        {data.sdrBreakdown.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Nenhum dado de vendedor no período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-[var(--muted)]/50">
                  <th className="p-3 text-left text-sm font-medium">Vendedor</th>
                  <th className="p-3 text-right text-sm font-medium">Ligações</th>
                  <th className="p-3 text-right text-sm font-medium">Duração Média</th>
                  <th className="p-3 text-right text-sm font-medium">Taxa Conexão</th>
                  <th className="p-3 text-right text-sm font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {data.sdrBreakdown.map((row) => (
                  <tr key={row.userId} className="border-b last:border-0">
                    <td className="p-3 text-sm">{row.userName}</td>
                    <td className="p-3 text-right text-sm">{row.calls}</td>
                    <td className="p-3 text-right text-sm">{formatDuration(row.avgDurationSeconds)}</td>
                    <td className="p-3 text-right text-sm">{row.connectionRate}%</td>
                    <td className="p-3 text-right text-sm">R$ {row.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
