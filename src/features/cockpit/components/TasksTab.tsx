'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';
import { Building2, Eye, Linkedin, Mail, MessageCircle, MoreVertical, Phone, Plus, Search, Workflow } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';

import type { DailyProgress } from '@/features/activities/actions/fetch-daily-progress';
import { ActivityExecutionSheet } from '@/features/activities/components/ActivityExecutionSheet';
import { ActivityPagination } from '@/features/activities/components/ActivityPagination';
import { ProgressCard } from '@/features/activities/components/ProgressCard';
import { SkipStepReasonDialog } from '@/features/activities/components/SkipStepReasonDialog';
import type { SkipReason } from '@/features/activities/constants/skip-reasons';
import type { PendingActivity } from '@/features/activities/types';
import { isOverdue } from '@/features/activities/utils/overdue';
import type { DialerProvider } from '@/features/calls/types/dialer-provider';
import { EnrollInCadenceDialog } from '@/features/leads/components/EnrollInCadenceDialog';
import { MarkLeadLostDialog } from '@/features/leads/components/MarkLeadLostDialog';
import { WhatsAppAutoSendCard } from '@/features/whatsapp-auto-send/components/WhatsAppAutoSendCard';
import type { CockpitData } from '@/features/whatsapp-auto-send/utils/cockpit-summary';

import { countByChannel, filterTasks, TASK_CHANNEL_TABS, type TaskChannelKey } from '../utils/task-filters';
import { NewTaskDialog } from './NewTaskDialog';

const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const todayKey = () => dayFmt.format(new Date());

const CHANNEL_ICON: Record<string, typeof Phone> = {
  phone: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  linkedin: Linkedin,
  research: Search,
};

const CHANNEL_LABEL: Record<string, string> = {
  phone: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
};

const keyOf = (a: PendingActivity) => `${a.enrollmentId}:${a.stepId}`;

interface TasksTabProps {
  initialActivities: PendingActivity[];
  progress: DailyProgress;
  autoSend: CockpitData | null;
  isOwn: boolean;
  dialerProvider: DialerProvider;
  targetUserId: string;
}

export function TasksTab({ initialActivities, progress, autoSend, isOwn, dialerProvider, targetUserId }: TasksTabProps) {
  const router = useRouter();
  const [activities, setActivities] = useState(initialActivities);
  const [channel, setChannel] = useState<TaskChannelKey>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [lostActivity, setLostActivity] = useState<PendingActivity | null>(null);
  const [skipActivity, setSkipActivity] = useState<PendingActivity | null>(null);
  const [switchActivity, setSwitchActivity] = useState<PendingActivity | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // Mesma reconciliação do /atividades: mantém a ordem local e acrescenta as novas.
  useEffect(() => {
    setActivities((prev) => {
      const fresh = new Set(initialActivities.map(keyOf));
      const known = new Set(prev.map(keyOf));
      return [...prev.filter((a) => fresh.has(keyOf(a))), ...initialActivities.filter((a) => !known.has(keyOf(a)))];
    });
  }, [initialActivities]);

  useEffect(() => setPage(1), [channel, search]);

  const counts = useMemo(() => countByChannel(activities), [activities]);
  const filtered = useMemo(() => filterTasks(activities, channel, search), [activities, channel, search]);
  const pageRows = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);

  const handleDone = useCallback((enrollmentId: string, stepId: string) => {
    setActivities((prev) => prev.filter((a) => !(a.enrollmentId === enrollmentId && a.stepId === stepId)));
  }, []);

  const handleRestore = useCallback((activity: PendingActivity) => {
    setActivities((prev) => (prev.some((a) => keyOf(a) === keyOf(activity)) ? prev : [activity, ...prev]));
  }, []);

  const handleIgnore = useCallback(
    (activity: PendingActivity) => {
      handleDone(activity.enrollmentId, activity.stepId);
      const isScheduled = activity.enrollmentId.startsWith('scheduled:');
      const run = isScheduled
        ? import('@/features/activities/actions/complete-scheduled-activity').then(({ completeScheduledActivity }) =>
            completeScheduledActivity(activity.stepId, 'cancelled'),
          )
        : import('@/features/activities/actions/ignore-activity').then(({ ignoreActivity }) =>
            ignoreActivity(activity.enrollmentId),
          );
      void run.then((r) => {
        if (!r.success) {
          handleRestore(activity);
          toast.error(r.error);
        } else {
          toast.success(isScheduled ? 'Atividade agendada cancelada' : 'Atividade ignorada');
        }
      });
    },
    [handleDone, handleRestore],
  );

  const handleSkipConfirm = useCallback(
    (reason: SkipReason, note?: string) => {
      const activity = skipActivity;
      if (!activity) return;
      setSkipActivity(null);
      handleDone(activity.enrollmentId, activity.stepId);
      void import('@/features/activities/actions/skip-step').then(({ skipStep }) =>
        skipStep({ enrollmentId: activity.enrollmentId, stepId: activity.stepId, reason, note }).then((r) => {
          if (!r.success) {
            handleRestore(activity);
            toast.error(r.error);
          } else {
            toast.success('Passo pulado — cadência avançou');
          }
        }),
      );
    },
    [skipActivity, handleDone, handleRestore],
  );

  const handleLostSuccess = useCallback(() => {
    if (!lostActivity) return;
    const lostKey = keyOf(lostActivity);
    const idx = filtered.findIndex((a) => keyOf(a) === lostKey);
    const next = idx >= 0 ? filtered[idx + 1] : undefined;
    handleDone(lostActivity.enrollmentId, lostActivity.stepId);
    setLostActivity(null);
    if (selectedKey === lostKey) setSelectedKey(next ? keyOf(next) : null);
  }, [lostActivity, filtered, handleDone, selectedKey]);

  const completedPct = progress.target > 0 ? Math.round((progress.completed / progress.target) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ProgressCard completed={progress.completed} total={progress.total} target={progress.target} guardrails={progress.guardrails} />
        {autoSend && <WhatsAppAutoSendCard data={autoSend} isOwn={isOwn} />}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-lg font-semibold">
          Tarefas do dia <span className="text-muted-foreground text-sm font-normal">({completedPct}% da meta feita)</span>
        </h2>
        <div className="flex gap-2">
          <div className="relative w-full md:w-72">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por tarefa, cadência ou lead..."
              className="pl-8"
              aria-label="Buscar tarefas"
            />
          </div>
          <Button onClick={() => setNewTaskOpen(true)} className="shrink-0">
            <Plus className="mr-1 h-4 w-4" /> Nova tarefa
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-[var(--card)]">
        <div className="flex flex-wrap gap-1 border-b px-3 pt-2" role="tablist" aria-label="Canal">
          {TASK_CHANNEL_TABS.map((t) => {
            const Icon = t.key === 'all' ? Workflow : (CHANNEL_ICON[t.key] ?? Workflow);
            const active = channel === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setChannel(t.key)}
                className={cn(
                  '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-[var(--primary)] font-medium text-[var(--foreground)]'
                    : 'text-muted-foreground border-transparent hover:text-[var(--foreground)]',
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                <span className="rounded border px-1.5 text-xs tabular-nums" data-testid={`count-${t.key}`}>
                  {counts[t.key]}
                </span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">
            {activities.length === 0 ? 'Nenhuma tarefa para hoje.' : 'Nenhuma tarefa com esse filtro.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium">
                <tr className="border-b">
                  <th className="px-4 py-3">Horário</th>
                  <th className="px-4 py-3">Tarefa</th>
                  <th className="px-4 py-3">Cadência</th>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((a) => (
                  <TaskRow
                    key={keyOf(a)}
                    activity={a}
                    onExecute={() => setSelectedKey(keyOf(a))}
                    onViewLead={() => router.push(`/leads/${a.lead.id}`)}
                    onIgnore={() => handleIgnore(a)}
                    onSkipStep={() => setSkipActivity(a)}
                    onSwitchCadence={() => setSwitchActivity(a)}
                    onLost={() => setLostActivity(a)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t px-4 py-2">
          <ActivityPagination
            total={filtered.length}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={(n) => {
              setPerPage(n);
              setPage(1);
            }}
          />
        </div>
      </div>

      <ActivityExecutionSheet
        activities={filtered}
        selectedKey={selectedKey}
        onClose={() => setSelectedKey(null)}
        onNavigate={setSelectedKey}
        onActivityDone={handleDone}
        onActivityRestore={handleRestore}
        onLeadLost={setLostActivity}
        onSwitchCadence={setSwitchActivity}
        dialerProvider={dialerProvider}
      />
      <SkipStepReasonDialog
        open={skipActivity !== null}
        onOpenChange={(open) => !open && setSkipActivity(null)}
        leadName={skipActivity?.lead.nome_fantasia ?? skipActivity?.lead.razao_social ?? undefined}
        onConfirm={handleSkipConfirm}
      />
      <MarkLeadLostDialog
        leadId={lostActivity?.lead.id ?? ''}
        open={lostActivity !== null}
        onOpenChange={(open) => !open && setLostActivity(null)}
        onSuccess={handleLostSuccess}
      />
      <EnrollInCadenceDialog
        open={switchActivity !== null}
        onOpenChange={(open) => !open && setSwitchActivity(null)}
        leadIds={switchActivity ? [switchActivity.lead.id] : []}
        mode="switch"
      />
      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} assignedTo={targetUserId} />
    </div>
  );
}

interface TaskRowProps {
  activity: PendingActivity;
  onExecute: () => void;
  onViewLead: () => void;
  onIgnore: () => void;
  onSkipStep: () => void;
  onSwitchCadence: () => void;
  onLost: () => void;
}

function TaskRow({ activity: a, onExecute, onViewLead, onIgnore, onSkipStep, onSwitchCadence, onLost }: TaskRowProps) {
  const Icon = CHANNEL_ICON[a.channel] ?? Workflow;
  const isScheduled = a.enrollmentId.startsWith('scheduled:');
  const due = new Date(a.nextStepDue);
  const overdue = isOverdue(a.nextStepDue);
  const dueLabel = dayFmt.format(due) === todayKey() ? timeFmt.format(due) : `${dayFmt.format(due)} ${timeFmt.format(due)}`;
  const dayLabel = a.stepDay ? `Dia ${a.stepDay}` : null;
  const taskName = a.activityName ?? `${CHANNEL_LABEL[a.channel] ?? a.channel}${dayLabel ? ` - ${dayLabel}` : ''}`;
  const company = a.lead.nome_fantasia ?? a.lead.razao_social ?? a.lead.cnpj;
  const contact = [a.lead.first_name, a.lead.last_name].filter(Boolean).join(' ');
  const phone = a.lead.telefone;

  return (
    <tr className="border-b last:border-b-0 hover:bg-[var(--accent)]/40">
      <td className={cn('px-4 py-2.5 font-medium tabular-nums', overdue && 'text-red-500')}>{dueLabel}</td>
      <td className="px-4 py-2.5">
        <button type="button" onClick={onExecute} className="flex items-center gap-2 text-left hover:underline">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs">{taskName}</span>
        </button>
      </td>
      <td className="px-4 py-2.5">
        <div className="text-xs font-medium">{a.cadenceName}</div>
        {!isScheduled && (
          <div className="text-muted-foreground text-[11px]">
            {[dayLabel, `Tarefa ${a.stepOrder}`].filter(Boolean).join(' · ')}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Building2 className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="max-w-[260px] truncate text-xs font-medium">{company}</div>
            <div className="text-muted-foreground max-w-[260px] truncate text-[11px]">
              {[contact, phone].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="text-xs">{a.lead.lead_source ?? '—'}</div>
        {a.lead.canal && <div className="text-muted-foreground text-[11px]">{a.lead.canal}</div>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onExecute} aria-label="Executar tarefa" title="Executar">
            <Icon className="h-4 w-4 text-[var(--primary)]" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onViewLead} aria-label="Ver lead" title="Ver lead">
            <Eye className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Mais ações">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isScheduled && <DropdownMenuItem onClick={onSkipStep}>Pular este passo</DropdownMenuItem>}
              {!isScheduled && <DropdownMenuItem onClick={onSwitchCadence}>Trocar cadência</DropdownMenuItem>}
              <DropdownMenuItem onClick={onIgnore}>{isScheduled ? 'Cancelar retorno' : 'Ignorar'}</DropdownMenuItem>
              <DropdownMenuItem onClick={onLost} className="text-red-600">
                Marcar como perdido
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}
