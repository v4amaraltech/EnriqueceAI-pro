'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Mail, MessageSquare, Phone, Search } from 'lucide-react';

import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { useDateRange } from '@/shared/hooks/useDateRange';

import type { ActivityAnalyticsData, ChannelCompletionEntry, UserActivityRow } from '../types/activity-analytics.types';
import type { OrgMember } from '../types/shared';

const CHANNEL_ICONS: Record<string, typeof Mail> = {
  research: Search,
  whatsapp: MessageSquare,
  email: Mail,
  phone: Phone,
};

const CHANNEL_LABELS: Record<string, string> = {
  research: 'Pesquisa',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  phone: 'Telefone',
};

function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

function ProgressRing({ percent, size = 64, strokeWidth = 5 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-[var(--border)]" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset} className="stroke-[#E53935]" />
    </svg>
  );
}

function ChannelCompletionCard({ entry }: { entry: ChannelCompletionEntry }) {
  const Icon = CHANNEL_ICONS[entry.channel] ?? Search;
  const label = CHANNEL_LABELS[entry.channel] ?? entry.label;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <ProgressRing percent={entry.completedPercent} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="h-5 w-5 text-[var(--muted-foreground)]" />
        </div>
      </div>
      <p className="text-[11px] font-medium text-[var(--muted-foreground)]">{label}</p>
      <p className="text-xs font-semibold">{entry.completedPercent.toFixed(0)}%</p>
    </div>
  );
}

type SortColumn = 'name' | 'leads' | 'activities' | 'onTime' | 'lost' | 'won';
type SortDirection = 'asc' | 'desc';

function SortIcon({ column, current }: { column: SortColumn; current: { column: SortColumn; direction: SortDirection } }) {
  const isActive = current.column === column;
  return (
    <span className="ml-1 inline-flex flex-col leading-none">
      <ChevronUp className={`h-3 w-3 -mb-0.5 ${isActive && current.direction === 'asc' ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]/40'}`} />
      <ChevronDown className={`h-3 w-3 ${isActive && current.direction === 'desc' ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]/40'}`} />
    </span>
  );
}

function sortUsers(users: UserActivityRow[], sort: { column: SortColumn; direction: SortDirection }): UserActivityRow[] {
  const sorted = [...users].sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case 'name':
        cmp = a.name.localeCompare(b.name, 'pt-BR');
        break;
      case 'leads':
        cmp = a.leads - b.leads;
        break;
      case 'activities':
        cmp = a.activitiesCompleted - b.activitiesCompleted;
        break;
      case 'onTime': {
        const aVal = a.onTimePercent ?? -1;
        const bVal = b.onTimePercent ?? -1;
        cmp = aVal - bVal;
        break;
      }
      case 'lost':
        cmp = a.lost - b.lost;
        break;
      case 'won':
        cmp = a.won - b.won;
        break;
    }
    return sort.direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

function UserRow({ user }: { user: UserActivityRow }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors">
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
            <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{user.name}</span>
        </div>
      </td>
      <td className="py-4 px-4 text-center text-sm">{fmt(user.leads)}</td>
      <td className="py-4 px-4 text-center text-sm">
        <span className="font-medium">{fmt(user.activitiesCompleted)}</span>
        <span className="text-[var(--muted-foreground)]"> de {fmt(user.activitiesTotal)}</span>
      </td>
      <td className="py-4 px-4 text-center text-sm">
        <span className={
          user.onTimePercent !== null
            ? user.onTimePercent >= 50
              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
              : 'text-[#E53935] font-medium'
            : 'text-[var(--muted-foreground)]'
        }>
          {user.onTimePercent !== null ? `${user.onTimePercent.toFixed(0)}%` : '—'}
        </span>
      </td>
      <td className="py-4 px-4 text-center text-sm">
        <span className="text-[#E53935] font-semibold underline decoration-[#E53935]/40">{fmt(user.lost)}</span>
      </td>
      <td className="py-4 px-4 text-center text-sm">
        <span className="text-emerald-600 dark:text-emerald-400 font-semibold underline decoration-emerald-600/40 dark:decoration-emerald-400/40">
          {fmt(user.won)}{user.wonPercent !== null && user.wonPercent > 0 ? ` (${user.wonPercent.toFixed(0)}%)` : ''}
        </span>
      </td>
      <td className="py-4 px-2 text-center">
        <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)]" />
      </td>
    </tr>
  );
}

interface ActivityAnalyticsViewProps {
  data: ActivityAnalyticsData;
  members: OrgMember[];
  hideFilters?: boolean;
  previousData?: ActivityAnalyticsData;
}

export function ActivityAnalyticsView({ data, members, hideFilters }: ActivityAnalyticsViewProps) {
  useDateRange('/statistics/activities');

  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'leads',
    direction: 'desc',
  });

  const lostPercent = data.leadsInPeriod > 0 ? ((data.totalLost / data.leadsInPeriod) * 100).toFixed(0) : '0';
  const wonPercent = data.leadsInPeriod > 0 ? ((data.totalWon / data.leadsInPeriod) * 100).toFixed(0) : '0';

  const sortedUsers = useMemo(() => sortUsers(data.userBreakdown, sort), [data.userBreakdown, sort]);

  function toggleSort(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'desc' },
    );
  }

  const thClass = 'py-3 px-4 text-center font-medium cursor-pointer select-none hover:bg-[var(--muted)]/50 transition-colors';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Atividades</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Análise de volume e performance de atividades.
          </p>
        </div>
        {!hideFilters && (
          <AnalyticsFilters basePath="/statistics/activities" members={members} />
        )}
      </div>

      {/* Summary bar + Channel completion */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          {/* Left: leads count + lost/won */}
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold">{fmt(data.leadsInPeriod)}</span>
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                leads com atividades no período
              </span>
            </div>
            <div className="mt-2 flex gap-6 text-sm">
              <span className="text-[#E53935] font-semibold underline decoration-[#E53935]/40">
                {fmt(data.totalLost)} perdas ({lostPercent}%)
              </span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold underline decoration-emerald-600/40 dark:decoration-emerald-400/40">
                {fmt(data.totalWon)} ganhos ({wonPercent}%)
              </span>
            </div>
          </div>

          {/* Right: channel rings */}
          <div className="flex gap-8">
            {data.channelCompletion.slice(0, 4).map((entry) => (
              <ChannelCompletionCard key={entry.channel} entry={entry} />
            ))}
          </div>
        </div>
      </div>

      {/* User breakdown table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
              <th className={`${thClass} !text-left`} onClick={() => toggleSort('name')}>
                <span className="inline-flex items-center">
                  Usuário
                  <SortIcon column="name" current={sort} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('leads')}>
                <span className="inline-flex items-center justify-center">
                  Leads
                  <SortIcon column="leads" current={sort} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('activities')}>
                <span className="inline-flex items-center justify-center">
                  Atividades
                  <SortIcon column="activities" current={sort} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('onTime')}>
                <span className="inline-flex items-center justify-center">
                  On time*
                  <SortIcon column="onTime" current={sort} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('lost')}>
                <span className="inline-flex items-center justify-center">
                  Perdidos
                  <SortIcon column="lost" current={sort} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('won')}>
                <span className="inline-flex items-center justify-center">
                  Ganhos
                  <SortIcon column="won" current={sort} />
                </span>
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {sortedUsers.length > 0 ? (
              sortedUsers.map((user) => (
                <UserRow key={user.userId} user={user} />
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[var(--muted-foreground)]">
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
