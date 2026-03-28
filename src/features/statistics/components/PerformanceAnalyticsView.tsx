'use client';

import { Mail, Phone, Search } from 'lucide-react';

import { LeadAvatar } from '@/features/leads/components/LeadAvatar';

import type { DailyControlRow, PerformanceAnalyticsData } from '../types/performance-analytics.types';

function ControlRow({ row }: { row: DailyControlRow }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30">
      <td className="p-3">
        <div className="flex items-center gap-2">
          <LeadAvatar name={row.userName} size="sm" />
          <span className="text-sm font-medium">{row.userName}</span>
        </div>
      </td>
      <td className="p-3 text-center text-sm">{row.prospecting}</td>
      <td className="p-3 text-center text-sm">{row.available}</td>
      <td className="p-3 text-center text-sm text-green-600 dark:text-green-400">{row.won}</td>
      <td className="p-3 text-center text-sm text-[#E53935]">{row.lost}</td>
      <td className="p-3 text-center text-sm">{row.pending}</td>
      <td className="p-3 text-center text-sm font-medium">{row.completed}</td>
      <td className="p-3 text-center text-sm">{row.ignored}</td>
      <td className="p-3 text-center text-sm">{row.calls}</td>
      <td className="p-3 text-center text-sm">{row.emails}</td>
      <td className="p-3 text-center text-sm">{row.research}</td>
    </tr>
  );
}

interface PerformanceAnalyticsViewProps {
  data: PerformanceAnalyticsData;
}

export function PerformanceAnalyticsView({ data }: PerformanceAnalyticsViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Painel de controle diário</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Monitore as atividades da sua equipe e mantenha o controle do desempenho diário
        </p>
      </div>

      {/* Users count */}
      <div className="flex items-center justify-end gap-2 text-sm text-[var(--muted-foreground)]">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        {data.dailyControl.length} usuários
      </div>

      {/* Daily control table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {/* Group headers */}
            <tr className="border-b border-[var(--border)]">
              <th className="p-3 text-left font-semibold text-xs uppercase tracking-wider" colSpan={1}>Time</th>
              <th className="p-3 text-center font-semibold text-xs uppercase tracking-wider bg-blue-50 dark:bg-blue-950/30" colSpan={4}>Leads</th>
              <th className="p-3 text-center font-semibold text-xs uppercase tracking-wider" colSpan={6}>Atividades</th>
            </tr>
            {/* Column headers */}
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
              <th className="p-3 text-left font-medium">Usuários</th>
              <th className="p-3 text-center font-medium bg-blue-50/50 dark:bg-blue-950/20">Prospectando</th>
              <th className="p-3 text-center font-medium bg-blue-50/50 dark:bg-blue-950/20">Disponíveis</th>
              <th className="p-3 text-center font-medium bg-blue-50/50 dark:bg-blue-950/20">Ganhos</th>
              <th className="p-3 text-center font-medium bg-blue-50/50 dark:bg-blue-950/20">Perdidos</th>
              <th className="p-3 text-center font-medium">Pendentes</th>
              <th className="p-3 text-center font-medium">Realizadas</th>
              <th className="p-3 text-center font-medium">Ignoradas</th>
              <th className="p-3 text-center font-medium" title="Ligações"><Phone className="h-4 w-4 mx-auto" /></th>
              <th className="p-3 text-center font-medium" title="E-mails"><Mail className="h-4 w-4 mx-auto" /></th>
              <th className="p-3 text-center font-medium" title="Pesquisa"><Search className="h-4 w-4 mx-auto" /></th>
            </tr>
          </thead>
          <tbody>
            {data.dailyControl.length > 0 ? (
              data.dailyControl.map((row) => <ControlRow key={row.userId} row={row} />)
            ) : (
              <tr>
                <td colSpan={11} className="p-8 text-center text-[var(--muted-foreground)]">
                  Nenhuma atividade no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
