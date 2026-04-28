'use client';

import { useMemo } from 'react';

import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  MessageSquare,
  Phone,
  Play,
  StickyNote,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { EngagementScoreBadge } from '@/features/leads/components/EngagementScoreBadge';

import type { PendingActivity } from '../types';

interface ReturnsTabProps {
  returns: PendingActivity[];
  onExecute: (activity: PendingActivity) => void;
  onIgnore: (activity: PendingActivity) => void;
  onViewLead: (leadId: string) => void;
  onLeadWon: (activity: PendingActivity) => void;
  onLeadLost: (activity: PendingActivity) => void;
}

interface GroupedReturns {
  overdue: PendingActivity[];
  today: PendingActivity[];
  upcoming: PendingActivity[];
}

function groupReturns(returns: PendingActivity[]): GroupedReturns {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const overdue: PendingActivity[] = [];
  const today: PendingActivity[] = [];
  const upcoming: PendingActivity[] = [];

  for (const r of returns) {
    const due = new Date(r.nextStepDue);
    if (due < now) {
      overdue.push(r);
    } else if (due < tomorrowStart) {
      today.push(r);
    } else {
      upcoming.push(r);
    }
  }

  return { overdue, today, upcoming };
}

function formatAbsoluteTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAbsoluteDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  });
}

function formatOverdueTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  if (diffD > 0) return `${diffD}d atrás`;
  if (diffH > 0) return `${diffH}h atrás`;
  const diffMin = Math.floor(diffMs / 60000);
  return `${diffMin}min atrás`;
}

const channelIcon: Record<string, typeof Phone> = {
  phone: Phone,
  whatsapp: MessageSquare,
};

const channelLabel: Record<string, string> = {
  phone: 'Ligação',
  whatsapp: 'WhatsApp',
};

function ReturnCard({
  activity,
  variant,
  onExecute,
  onIgnore,
  onViewLead,
  onLeadWon,
  onLeadLost,
}: {
  activity: PendingActivity;
  variant: 'overdue' | 'today' | 'upcoming';
  onExecute: () => void;
  onIgnore: () => void;
  onViewLead: () => void;
  onLeadWon: () => void;
  onLeadLost: () => void;
}) {
  const Icon = channelIcon[activity.channel] ?? Phone;
  const label = channelLabel[activity.channel] ?? activity.channel;
  const leadName = activity.lead.nome_fantasia ?? activity.lead.razao_social ?? activity.lead.cnpj;

  const borderClass =
    variant === 'overdue'
      ? 'border-red-500/40 bg-red-50/30 dark:bg-red-950/15'
      : variant === 'today'
        ? 'border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/15'
        : 'border-[var(--border)]';

  return (
    <div className={`rounded-lg border ${borderClass} px-4 py-3 transition-colors hover:bg-[var(--accent)]/30`}>
      <div className="flex items-start justify-between gap-4">
        {/* Left: lead info */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <EngagementScoreBadge score={activity.lead.engagement_score} size={32} />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{leadName}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-[var(--muted-foreground)]">
              {/* Time badge */}
              {variant === 'overdue' ? (
                <span className="inline-flex items-center gap-1 font-semibold text-red-500">
                  <AlertCircle className="h-3 w-3" />
                  {formatOverdueTime(activity.nextStepDue)} · era {formatAbsoluteTime(activity.nextStepDue)}
                </span>
              ) : variant === 'today' ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                  <Clock className="h-3 w-3" />
                  Hoje às {formatAbsoluteTime(activity.nextStepDue)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {formatAbsoluteDate(activity.nextStepDue)} às {formatAbsoluteTime(activity.nextStepDue)}
                </span>
              )}

              {/* Channel */}
              <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
                <Icon className="h-2.5 w-2.5" />
                {label}
              </Badge>

              {/* Phone */}
              {activity.lead.telefone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {activity.lead.telefone}
                </span>
              )}
            </div>

            {/* Notes */}
            {activity.callScript && (
              <div className="mt-2 flex items-start gap-1.5 rounded bg-[var(--muted)]/50 px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
                <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="line-clamp-2">{activity.callScript}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" onClick={onExecute} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Executar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                <span className="sr-only">Ações</span>
                ···
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onIgnore}>
                <X className="mr-2 h-3.5 w-3.5" />
                Cancelar retorno
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onViewLead}>
                <Eye className="mr-2 h-3.5 w-3.5" />
                Visualizar lead
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLeadWon}>
                <UserCheck className="mr-2 h-3.5 w-3.5" />
                Lead ganho
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLeadLost}>
                <UserX className="mr-2 h-3.5 w-3.5" />
                Lead perdido
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon: SectionIcon, title, count, variant }: {
  icon: typeof AlertCircle;
  title: string;
  count: number;
  variant: 'overdue' | 'today' | 'upcoming';
}) {
  const colorClass =
    variant === 'overdue'
      ? 'text-red-500'
      : variant === 'today'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-[var(--muted-foreground)]';

  return (
    <div className="flex items-center gap-2 py-2">
      <SectionIcon className={`h-4 w-4 ${colorClass}`} />
      <h3 className={`text-sm font-semibold ${colorClass}`}>
        {title}
      </h3>
      <span className={`text-xs ${colorClass} opacity-70`}>({count})</span>
    </div>
  );
}

export function ReturnsTab({ returns, onExecute, onIgnore, onViewLead, onLeadWon, onLeadLost }: ReturnsTabProps) {
  const grouped = useMemo(() => groupReturns(returns), [returns]);

  if (returns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] px-4 py-16 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500/50 mb-3" />
        <h3 className="text-sm font-medium text-[var(--foreground)]">
          Nenhum retorno pendente
        </h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-[280px]">
          Retornos agendados durante a execução de atividades aparecerão aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-lg border bg-[var(--card)] px-4 py-3 text-sm">
        {grouped.overdue.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-red-500 font-medium">
            <AlertCircle className="h-4 w-4" />
            {grouped.overdue.length} atrasado{grouped.overdue.length > 1 ? 's' : ''}
          </span>
        )}
        {grouped.today.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
            <Clock className="h-4 w-4" />
            {grouped.today.length} para hoje
          </span>
        )}
        {grouped.upcoming.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
            <CalendarClock className="h-4 w-4" />
            {grouped.upcoming.length} próximos dias
          </span>
        )}
      </div>

      {/* Overdue section */}
      {grouped.overdue.length > 0 && (
        <div>
          <SectionHeader icon={AlertCircle} title="Atrasados" count={grouped.overdue.length} variant="overdue" />
          <div className="space-y-2">
            {grouped.overdue.map((a) => (
              <ReturnCard
                key={`${a.enrollmentId}:${a.stepId}`}
                activity={a}
                variant="overdue"
                onExecute={() => onExecute(a)}
                onIgnore={() => onIgnore(a)}
                onViewLead={() => onViewLead(a.lead.id)}
                onLeadWon={() => onLeadWon(a)}
                onLeadLost={() => onLeadLost(a)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Today section */}
      {grouped.today.length > 0 && (
        <div>
          <SectionHeader icon={Clock} title="Hoje" count={grouped.today.length} variant="today" />
          <div className="space-y-2">
            {grouped.today.map((a) => (
              <ReturnCard
                key={`${a.enrollmentId}:${a.stepId}`}
                activity={a}
                variant="today"
                onExecute={() => onExecute(a)}
                onIgnore={() => onIgnore(a)}
                onViewLead={() => onViewLead(a.lead.id)}
                onLeadWon={() => onLeadWon(a)}
                onLeadLost={() => onLeadLost(a)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Upcoming section */}
      {grouped.upcoming.length > 0 && (
        <div>
          <SectionHeader icon={CalendarClock} title="Próximos dias" count={grouped.upcoming.length} variant="upcoming" />
          <div className="space-y-2">
            {grouped.upcoming.map((a) => (
              <ReturnCard
                key={`${a.enrollmentId}:${a.stepId}`}
                activity={a}
                variant="upcoming"
                onExecute={() => onExecute(a)}
                onIgnore={() => onIgnore(a)}
                onViewLead={() => onViewLead(a.lead.id)}
                onLeadWon={() => onLeadWon(a)}
                onLeadLost={() => onLeadLost(a)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
