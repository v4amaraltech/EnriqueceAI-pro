'use client';

import { useMemo } from 'react';
import { Info, Mail, Phone, Search } from 'lucide-react';
import Image from 'next/image';

import { LeadAvatar } from '@/features/leads/components/LeadAvatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

import type { DailyControlRow, PerformanceAnalyticsData } from '../types/performance-analytics.types';

function formatLastActivity(isoDate?: string): string {
  if (!isoDate) return '-';
  const date = new Date(isoDate);
  return `Visto às ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}h`;
}

function UserAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={32}
        height={32}
        className="h-8 w-8 rounded-full object-cover"
      />
    );
  }
  return <LeadAvatar name={name} size="sm" />;
}

function ControlRow({ row }: { row: DailyControlRow }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30">
      {/* Usuários */}
      <td className="p-3">
        <div className="flex items-center gap-2">
          <UserAvatar name={row.userName} avatarUrl={row.avatarUrl} />
          <div className="min-w-0">
            <span className="text-sm font-medium block truncate max-w-[120px]">{row.userName}</span>
            <span className="text-xs text-[var(--muted-foreground)]">Offline</span>
          </div>
        </div>
      </td>
      {/* Atividade Atual */}
      <td className="p-3">
        <div className="min-w-0">
          <span className="text-xs text-[var(--muted-foreground)] block">Última atividade</span>
          <span className="text-xs block">{formatLastActivity(row.lastActivityAt)}</span>
        </div>
      </td>
      {/* Duração */}
      <td className="p-3 text-center text-sm text-[var(--muted-foreground)]" />
      {/* Leads */}
      <td className="p-3 text-center text-sm">{row.prospecting}</td>
      <td className="p-3 text-center text-sm">{row.available}</td>
      <td className="p-3 text-center text-sm text-green-600 dark:text-green-400">{row.won}</td>
      <td className="p-3 text-center text-sm text-[#E53935]">{row.lost}</td>
      {/* Atividades */}
      <td className="p-3 text-center text-sm">{row.pending}</td>
      <td className="p-3 text-center text-sm">{row.completed}</td>
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
  const lastUpdated = useMemo(() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Painel de controle diário</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Monitore as atividades da sua equipe e mantenha o controle do desempenho diário
        </p>
      </div>

      {/* Users count + last updated */}
      <div className="flex items-center justify-end gap-4 text-sm text-[var(--muted-foreground)]">
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {data.dailyControl.length} usuários
          </div>
          <span className="text-xs">Última atualização às {lastUpdated}</span>
        </div>
      </div>

      {/* Daily control table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {/* Group headers */}
            <tr className="border-b border-[var(--border)]">
              <th className="p-3 text-left font-semibold text-xs uppercase tracking-wider" colSpan={3}>Time</th>
              <th className="p-3 text-center font-semibold text-xs uppercase tracking-wider bg-blue-50 dark:bg-blue-950/30" colSpan={4}>Leads</th>
              <th className="p-3 text-center font-semibold text-xs uppercase tracking-wider" colSpan={6}>Atividades</th>
            </tr>
            {/* Column headers */}
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
              <th className="p-3 text-left font-medium">Usuários</th>
              <th className="p-3 text-left font-medium">Atividade Atual</th>
              <th className="p-3 text-center font-medium">Duração</th>
              <th className="p-3 text-center font-medium bg-blue-50/50 dark:bg-blue-950/20">Prospectando</th>
              <th className="p-3 text-center font-medium bg-blue-50/50 dark:bg-blue-950/20">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1">
                        Disponíveis
                        <Info className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Leads com status &quot;Novo&quot; que ainda não foram iniciados em nenhuma cadência</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </th>
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
                <td colSpan={13} className="p-8 text-center text-[var(--muted-foreground)]">
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
