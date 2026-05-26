'use client';

import { useState } from 'react';

import {
  ChevronDown,
  Eye,
  Linkedin,
  Mail,
  MessageSquare,
  Phone,
  Play,
  Search,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { EngagementScoreBadge } from '@/features/leads/components/EngagementScoreBadge';

import type { PendingActivity } from '../types';

interface ActivityRowProps {
  activity: PendingActivity;
  onExecute: () => void;
  onIgnore: () => void;
  onViewLead: () => void;
  onLeadWon: () => void;
  onLeadLost: () => void;
}

export function formatRelativeTime(dateStr: string): { text: string; isUrgent: boolean } {
  const now = Date.now();
  const due = new Date(dateStr).getTime();
  const diffMs = now - due;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Urgent if overdue > 1 hour (AC 7)
  const isUrgent = diffHours >= 1;

  if (diffMinutes < 1) return { text: 'Agora', isUrgent: false };
  if (diffMinutes < 60) return { text: `Há ${diffMinutes}min`, isUrgent };
  if (diffHours < 24) return { text: `Há ${diffHours}h`, isUrgent };
  return { text: `Há ${diffDays}d`, isUrgent };
}

const channelIcon: Record<string, typeof Mail> = {
  email: Mail,
  whatsapp: MessageSquare,
  phone: Phone,
  linkedin: Linkedin,
  research: Search,
};

const channelLabel: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  phone: 'Ligação',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
};

/** Grid column definition shared with ActivityQueueView header */
export const ACTIVITY_GRID_COLS = 'grid grid-cols-[minmax(140px,1.2fr)_minmax(140px,1.2fr)_minmax(140px,1.2fr)_auto]';

function formatScheduledTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Hoje ${time}`;
  const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  return `${date} ${time}`;
}

export function ActivityRow({ activity, onExecute, onIgnore, onViewLead, onLeadWon, onLeadLost }: ActivityRowProps) {
  const { text: timeText, isUrgent } = formatRelativeTime(activity.nextStepDue);
  const Icon = channelIcon[activity.channel] ?? Mail;
  const label = channelLabel[activity.channel] ?? activity.channel;
  const isScheduled = activity.enrollmentId.startsWith('scheduled:');
  const [confirmEndCadence, setConfirmEndCadence] = useState(false);
  const leadName = activity.lead.nome_fantasia || activity.lead.razao_social || 'este lead';

  return (
    <div className={`${ACTIVITY_GRID_COLS} items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 transition-colors hover:bg-[var(--accent)]/50`}>
      {/* Column 1: ATIVIDADE (tempo + canal) */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`shrink-0 min-w-[80px] text-xs font-bold uppercase tabular-nums ${
            isUrgent ? 'text-red-500' : 'text-[var(--muted-foreground)] dark:text-[var(--foreground)]'
          }`}
        >
          {isScheduled ? formatScheduledTime(activity.nextStepDue) : timeText}
        </span>
        <Badge variant="outline" className="shrink-0 gap-1">
          <Icon className="h-3 w-3" />
          {label}
        </Badge>
      </div>

      {/* Column 2: CADÊNCIA (nome + passo) or RETORNO (notes) */}
      <div className="min-w-0">
        {activity.enrollmentId.startsWith('scheduled:') ? (
          <>
            <p className="text-sm font-medium truncate">
              Retorno agendado
            </p>
            {activity.callScript && (
              <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)] line-clamp-2">
                {activity.callScript}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-medium">
              {activity.cadenceName}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Passo {activity.stepOrder} de {activity.totalSteps}
            </p>
          </>
        )}
      </div>

      {/* Column 3: LEAD (nome + email + engagement) */}
      <div className="flex items-center gap-2 min-w-0">
        <EngagementScoreBadge score={activity.lead.engagement_score} size={24} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {activity.lead.nome_fantasia ?? activity.lead.razao_social ?? activity.lead.cnpj}
          </p>
          <p className="truncate text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            {activity.lead.email
              ?? (activity.lead.socios as Array<{ emails?: Array<{ email: string; ranking: number }> }> | null)
                ?.[0]?.emails?.sort((a, b) => a.ranking - b.ranking)[0]?.email
              ?? 'Sem email'}
          </p>
        </div>
      </div>

      {/* Column 4: AÇÕES */}
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={onExecute} className="gap-1.5">
          <Play className="h-3.5 w-3.5" />
          Executar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setConfirmEndCadence(true)}>
              <X className="mr-2 h-3.5 w-3.5" />
              Encerrar cadência
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onViewLead}>
              <Eye className="mr-2 h-3.5 w-3.5" />
              Visualizar
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

      <Dialog open={confirmEndCadence} onOpenChange={setConfirmEndCadence}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar cadência?</DialogTitle>
            <DialogDescription>
              <strong>{leadName}</strong> vai sair da cadência <strong>{activity.cadenceName}</strong> e
              todas as próximas atividades programadas para esse lead serão removidas. O lead permanece no funil
              com o status atual — você ainda pode contatá-lo manualmente.
              <br />
              <br />
              Para apenas adiar esta atividade, use <strong>Pular</strong> em vez disso.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEndCadence(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmEndCadence(false);
                onIgnore();
              }}
            >
              Encerrar cadência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
