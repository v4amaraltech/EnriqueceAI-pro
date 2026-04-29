'use client';

import { useMemo, useState } from 'react';

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { EngagementScoreBadge } from '@/features/leads/components/EngagementScoreBadge';

import type { PendingActivity } from '../types';
import { ActivityPagination } from './ActivityPagination';

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
    <div className={`flex items-center gap-4 rounded-lg border ${borderClass} px-4 py-3 min-h-[56px] transition-colors hover:bg-[var(--accent)]/30`}>
      {/* Engagement score */}
      <EngagementScoreBadge score={activity.lead.engagement_score} size={28} />

      {/* Lead name */}
      <div className="min-w-0 w-[180px] shrink-0">
        <p className="font-medium truncate text-sm">{leadName}</p>
      </div>

      {/* Time */}
      <div className="shrink-0 min-w-[130px]">
        {variant === 'overdue' ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500">
            <AlertCircle className="h-3 w-3" />
            {formatOverdueTime(activity.nextStepDue)} · era {formatAbsoluteTime(activity.nextStepDue)}
          </span>
        ) : variant === 'today' ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Clock className="h-3 w-3" />
            Hoje às {formatAbsoluteTime(activity.nextStepDue)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
            <CalendarClock className="h-3 w-3" />
            {formatAbsoluteDate(activity.nextStepDue)} às {formatAbsoluteTime(activity.nextStepDue)}
          </span>
        )}
      </div>

      {/* Channel */}
      <Badge variant="outline" className="shrink-0 gap-1 text-[10px] px-1.5 py-0">
        <Icon className="h-2.5 w-2.5" />
        {label}
      </Badge>

      {/* Phone */}
      {activity.lead.telefone && (
        <span className="shrink-0 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
          <Phone className="h-3 w-3" />
          {activity.lead.telefone}
        </span>
      )}

      {/* Notes (inline, truncated with tooltip) */}
      {activity.callScript && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] min-w-0 flex-1 truncate">
              <StickyNote className="h-3 w-3 shrink-0" />
              <span className="truncate">{activity.callScript}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[300px]">
            <p className="text-xs whitespace-pre-wrap">{activity.callScript}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Spacer */}
      {!activity.callScript && <div className="flex-1" />}

      {/* Actions */}
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

function renderSection(
  activities: PendingActivity[],
  variant: 'overdue' | 'today' | 'upcoming',
  icon: typeof AlertCircle,
  title: string,
  callbacks: Omit<ReturnsTabProps, 'returns'>,
) {
  if (activities.length === 0) return null;

  return (
    <div>
      <SectionHeader icon={icon} title={title} count={activities.length} variant={variant} />
      <div className="space-y-1.5">
        {activities.map((a) => (
          <ReturnCard
            key={`${a.enrollmentId}:${a.stepId}`}
            activity={a}
            variant={variant}
            onExecute={() => callbacks.onExecute(a)}
            onIgnore={() => callbacks.onIgnore(a)}
            onViewLead={() => callbacks.onViewLead(a.lead.id)}
            onLeadWon={() => callbacks.onLeadWon(a)}
            onLeadLost={() => callbacks.onLeadLost(a)}
          />
        ))}
      </div>
    </div>
  );
}

export function ReturnsTab({ returns, onExecute, onIgnore, onViewLead, onLeadWon, onLeadLost }: ReturnsTabProps) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const grouped = useMemo(() => groupReturns(returns), [returns]);

  // Flatten all returns in priority order for pagination
  const allSorted = useMemo(
    () => [...grouped.overdue, ...grouped.today, ...grouped.upcoming],
    [grouped],
  );

  const paginatedReturns = useMemo(() => {
    const start = (page - 1) * perPage;
    return allSorted.slice(start, start + perPage);
  }, [allSorted, page, perPage]);

  // Re-group the paginated slice
  const paginatedGrouped = useMemo(() => groupReturns(paginatedReturns), [paginatedReturns]);

  const callbacks = { onExecute, onIgnore, onViewLead, onLeadWon, onLeadLost };

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
    <div className="space-y-4">
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

      {/* Sections (paginated) */}
      {renderSection(paginatedGrouped.overdue, 'overdue', AlertCircle, 'Atrasados', callbacks)}
      {renderSection(paginatedGrouped.today, 'today', Clock, 'Hoje', callbacks)}
      {renderSection(paginatedGrouped.upcoming, 'upcoming', CalendarClock, 'Próximos dias', callbacks)}

      {/* Pagination */}
      <ActivityPagination
        total={allSorted.length}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={(v) => { setPerPage(v); setPage(1); }}
      />
    </div>
  );
}
