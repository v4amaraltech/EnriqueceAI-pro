'use client';

import { Mail, MessageSquare, Phone, Search } from 'lucide-react';

import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import { useDateRange } from '@/shared/hooks/useDateRange';
import { LeadAvatar } from '@/features/leads/components/LeadAvatar';

import type { ActivityAnalyticsData, ChannelCompletionEntry, UserActivityRow } from '../types/activity-analytics.types';
import type { OrgMember } from '../types/shared';

const CHANNEL_ICONS: Record<string, typeof Mail> = {
  research: Search,
  whatsapp: MessageSquare,
  email: Mail,
  phone: Phone,
};

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
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <ProgressRing percent={entry.completedPercent} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="h-5 w-5 text-[var(--muted-foreground)]" />
        </div>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{entry.completedPercent.toFixed(0)}% completado</p>
    </div>
  );
}

function UserRow({ user }: { user: UserActivityRow }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30">
      <td className="p-3">
        <div className="flex items-center gap-3">
          <LeadAvatar name={user.name} size="sm" />
          <span className="text-sm font-medium">{user.name}</span>
        </div>
      </td>
      <td className="p-3 text-center text-sm">{user.leads}</td>
      <td className="p-3 text-center text-sm">{user.activitiesCompleted} de {user.activitiesTotal}</td>
      <td className="p-3 text-center text-sm">
        <span className={user.onTimePercent !== null && user.onTimePercent >= 50 ? 'text-green-600 dark:text-green-400' : 'text-[var(--muted-foreground)]'}>
          {user.onTimePercent !== null ? `${user.onTimePercent.toFixed(0)}%` : '—'}
        </span>
      </td>
      <td className="p-3 text-center text-sm">
        <span className="text-[#E53935]">{user.lost}</span>
      </td>
      <td className="p-3 text-center text-sm">
        <span className="text-green-600 dark:text-green-400">
          {user.won}{user.wonPercent !== null && user.wonPercent > 0 ? ` (${user.wonPercent.toFixed(0)}%)` : ''}
        </span>
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

  const lostPercent = data.leadsInPeriod > 0 ? ((data.totalLost / data.leadsInPeriod) * 100).toFixed(0) : '0';
  const wonPercent = data.leadsInPeriod > 0 ? ((data.totalWon / data.leadsInPeriod) * 100).toFixed(0) : '0';

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
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{data.leadsInPeriod.toLocaleString('pt-BR')}</span>
              <span className="text-sm font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                leads com atividades no período
              </span>
            </div>
            <div className="mt-1 flex gap-4 text-sm">
              <span className="text-[#E53935] font-semibold">
                {data.totalLost} perdas <span className="font-normal">({lostPercent}%)</span>
              </span>
              <span className="text-green-600 dark:text-green-400 font-semibold">
                {data.totalWon} ganhos <span className="font-normal">({wonPercent}%)</span>
              </span>
            </div>
          </div>
          <div className="flex gap-6">
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
              <th className="p-3 text-left font-medium">Usuário</th>
              <th className="p-3 text-center font-medium">Leads</th>
              <th className="p-3 text-center font-medium">Atividades</th>
              <th className="p-3 text-center font-medium">On time*</th>
              <th className="p-3 text-center font-medium">Perdidos</th>
              <th className="p-3 text-center font-medium">Ganhos</th>
            </tr>
          </thead>
          <tbody>
            {data.userBreakdown.length > 0 ? (
              data.userBreakdown.map((user) => (
                <UserRow key={user.userId} user={user} />
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[var(--muted-foreground)]">
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
