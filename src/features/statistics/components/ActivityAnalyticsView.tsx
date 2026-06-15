'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Mail, MessageSquare, Phone, Reply, Search, UserCheck, Users } from 'lucide-react';

import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { useDateRange } from '@/shared/hooks/useDateRange';

import { GoalAchievementCard } from './GoalAchievementCard';

import type { ActivityAnalyticsData, ChannelCompletionEntry, UserActivityRow, UserChannelProgress } from '../types/activity-analytics.types';
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
        strokeDasharray={circumference} strokeDashoffset={offset} className="stroke-primary" />
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
        cmp = a.totalLeads - b.totalLeads;
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

function ChannelProgressBar({ entry }: { entry: UserChannelProgress }) {
  const percent = entry.total > 0 ? (entry.completed / entry.total) * 100 : 0;
  const Icon = CHANNEL_ICONS[entry.channel] ?? Search;
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      <span className="w-20 shrink-0 text-xs text-[var(--muted-foreground)]">{entry.label}</span>
      <div className="flex-1 h-6 rounded-md bg-[var(--muted)]/40 overflow-hidden relative">
        <div
          className="h-full rounded-md bg-emerald-500 transition-all"
          style={{ width: `${Math.max(percent, entry.completed > 0 ? 8 : 0)}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold" style={{ color: 'white' }}>
          {fmt(entry.completed)}
        </span>
      </div>
    </div>
  );
}

function UserExpandedDetails({ user }: { user: UserActivityRow }) {
  const wonLostTotal = user.won + user.lost;
  const lostPercent = wonLostTotal > 0 ? ((user.lost / wonLostTotal) * 100).toFixed(0) : '0';
  const wonPercent = wonLostTotal > 0 ? ((user.won / wonLostTotal) * 100).toFixed(0) : '0';

  return (
    <tr className="border-b border-[var(--border)] bg-[var(--muted)]/10">
      <td colSpan={7} className="px-6 py-5">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Left: Geral */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-4">Geral</h4>
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 text-sm">
                <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span className="text-[var(--foreground)]">Novos leads: <span className="font-semibold">{fmt(user.leads)}</span></span>
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <Reply className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span className="text-[var(--foreground)]">Resposta Inbound: <span className="font-semibold">{user.inboundReplies > 0 ? fmt(user.inboundReplies) : '-'}</span></span>
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <UserCheck className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span className="text-[var(--foreground)]">Leads que realizaram a primeira atividade: <span className="font-semibold">{fmt(user.leadsWithFirstActivity)}</span></span>
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <Phone className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span className="text-[var(--foreground)]">Ligações: <span className="font-semibold">{fmt(user.phoneCalls)}</span></span>
              </div>
            </div>
          </div>

          {/* Right: Progresso por atividade */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Progresso por atividade</h4>
              <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />Finalizado</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[var(--muted)]" />Pendente</span>
              </div>
            </div>
            <div className="space-y-3">
              {user.channelProgress.length > 0 ? (
                user.channelProgress.map((cp) => (
                  <ChannelProgressBar key={cp.channel} entry={cp} />
                ))
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">Sem atividades no período.</p>
              )}
            </div>
          </div>
        </div>

        {/* Leads Finalizados */}
        <div className="mt-6 pt-4 border-t border-[var(--border)]">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
            Leads finalizados{wonLostTotal > 0 ? ` (${fmt(wonLostTotal)})` : ''}
          </h4>
          {wonLostTotal > 0 ? (
            <div className="flex items-center gap-4">
              <div className="flex-1 h-8 rounded-full overflow-hidden flex">
                {user.lost > 0 && (
                  <div
                    className="h-full bg-primary flex items-center justify-center text-[11px] font-semibold text-white"
                    style={{ width: `${lostPercent}%`, minWidth: '3rem' }}
                  >
                    {lostPercent}%
                  </div>
                )}
                {user.won > 0 && (
                  <div
                    className="h-full bg-emerald-500 flex items-center justify-center text-[11px] font-semibold text-white"
                    style={{ width: `${wonPercent}%`, minWidth: '3rem' }}
                  >
                    {wonPercent}%
                  </div>
                )}
              </div>
              <div className="flex gap-4 text-xs shrink-0">
                <span className="text-primary font-medium">Perdidos {fmt(user.lost)}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Ganhos {fmt(user.won)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">Nenhum lead finalizado no período.</p>
          )}
        </div>

        {/* Distribuição dos leads em prospecção */}
        {user.leadsInProspection > 0 && (
          <div className="mt-5 pt-4 border-t border-[var(--border)]">
            <h4 className="text-sm text-[var(--foreground)] mb-3">
              Distribuição dos leads em prospecção ({fmt(user.leadsInProspection)})
            </h4>
            <div className="flex h-8 rounded-md overflow-hidden">
              {user.quartiles.map((q, i) => (
                <div
                  key={q.quartile}
                  className="relative flex items-center justify-center bg-[var(--muted-foreground)] text-white"
                  style={{ width: `${q.percent}%`, minWidth: '3rem' }}
                >
                  <span className="relative z-10 text-[11px] font-medium whitespace-nowrap">
                    Quartil {q.quartile}: {q.percent}%
                  </span>
                  {i < user.quartiles.length - 1 && (
                    <div className="absolute right-0 top-0 z-20 h-full flex items-center">
                      <svg width="12" height="32" viewBox="0 0 12 32" className="text-white/80">
                        <path d="M0 0 L10 16 L0 32" fill="currentColor" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

function UserRow({ user, isExpanded, onToggle }: { user: UserActivityRow; isExpanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-4 px-4">
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
              <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">{user.name}</span>
          </div>
        </td>
        <td className="py-4 px-4 text-center text-sm">{fmt(user.totalLeads)}</td>
        <td className="py-4 px-4 text-center text-sm">
          <span className="font-medium">{fmt(user.activitiesCompleted)}</span>
          <span className="text-[var(--muted-foreground)]"> de {fmt(user.activitiesTotal)}</span>
        </td>
        <td className="py-4 px-4 text-center text-sm">
          <span className={
            user.onTimePercent !== null
              ? user.onTimePercent >= 50
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-primary font-medium'
              : 'text-[var(--muted-foreground)]'
          }>
            {user.onTimePercent !== null ? `${user.onTimePercent.toFixed(0)}%` : '—'}
          </span>
        </td>
        <td className="py-4 px-4 text-center text-sm">
          <span className="text-primary font-semibold underline decoration-primary/40">{fmt(user.lost)}</span>
        </td>
        <td className="py-4 px-4 text-center text-sm">
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold underline decoration-emerald-600/40 dark:decoration-emerald-400/40">
            {fmt(user.won)}{user.wonPercent !== null && user.wonPercent > 0 ? ` (${user.wonPercent.toFixed(0)}%)` : ''}
          </span>
        </td>
        <td className="py-4 px-2 text-center">
          {isExpanded
            ? <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" />
            : <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
          }
        </td>
      </tr>
      {isExpanded && <UserExpandedDetails user={user} />}
    </>
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
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

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

      {/* Daily activity goal (today, BRT) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <GoalAchievementCard goal={data.goal} />
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
              <span className="text-primary font-semibold underline decoration-primary/40">
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
                <UserRow
                  key={user.userId}
                  user={user}
                  isExpanded={expandedUserId === user.userId}
                  onToggle={() => setExpandedUserId((prev) => prev === user.userId ? null : user.userId)}
                />
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
