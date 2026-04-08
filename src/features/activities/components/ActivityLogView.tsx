'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ListChecks, SearchX, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { PendingActivity } from '../types';
import { ActivityExecutionSheet } from './ActivityExecutionSheet';
import { ActivityPagination } from './ActivityPagination';
import { ActivityRow, ACTIVITY_GRID_COLS } from './ActivityRow';

interface ActivityLogViewProps {
  activities: PendingActivity[];
  total: number;
  hasFilters: boolean;
}

const ALL_VALUE = '__all__';
const DEFAULT_PER_PAGE = 25;

const channelOptions = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Ligação' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'research', label: 'Pesquisa' },
];

const statusOptions = [
  { value: 'overdue', label: 'Atrasadas' },
  { value: 'due', label: 'No prazo' },
];

export function ActivityLogView({ activities: initialActivities, total, hasFilters }: ActivityLogViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activities, setActivities] = useState<PendingActivity[]>(initialActivities);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const currentStatus = searchParams.get('status') ?? '';
  const currentChannel = searchParams.get('channel') ?? '';
  const currentSearch = searchParams.get('search') ?? '';

  // Optimistic overrides for instant Select feedback
  const paramsKey = searchParams.toString();
  const [lastParamsKey, setLastParamsKey] = useState(paramsKey);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  if (paramsKey !== lastParamsKey) {
    setLastParamsKey(paramsKey);
    setOverrides({});
  }

  const activeStatus = overrides.status ?? (currentStatus || ALL_VALUE);
  const activeChannel = overrides.channel ?? (currentChannel || ALL_VALUE);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/activities?${params.toString()}`);
    },
    [router, searchParams],
  );

  const clearFilters = useCallback(() => {
    router.push('/templates');
  }, [router]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);

  // Cadence filter (client-side since cadences come from the data)
  const [cadenceFilter, setCadenceFilter] = useState('all');
  const [stepFilter, setStepFilter] = useState('all');

  // Only current-step activities are shown; future steps stay in state for promotion
  const visibleActivities = useMemo(() => activities.filter((a) => a.isCurrentStep), [activities]);

  const cadenceOptions = useMemo(
    () => [...new Set(visibleActivities.map((a) => a.cadenceName))].sort(),
    [visibleActivities],
  );

  const filtered = useMemo(() => {
    return visibleActivities.filter((a) => {
      if (cadenceFilter !== 'all' && a.cadenceName !== cadenceFilter) return false;
      if (stepFilter !== 'all' && String(a.stepOrder) !== stepFilter) return false;
      return true;
    });
  }, [visibleActivities, cadenceFilter, stepFilter]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [cadenceFilter, stepFilter, currentStatus, currentChannel, currentSearch]);

  // Paginated slice
  const paginatedActivities = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const handlePerPageChange = useCallback((newPerPage: number) => {
    setPerPage(newPerPage);
    setPage(1);
  }, []);

  const handleActivityDone = useCallback((enrollmentId: string, stepId: string) => {
    setActivities((prev) => {
      const updated = prev.filter(
        (a) => !(a.enrollmentId === enrollmentId && a.stepId === stepId),
      );
      const nextStep = updated.find(
        (a) => a.enrollmentId === enrollmentId && !a.isCurrentStep,
      );
      if (nextStep) {
        return updated.map((a) =>
          a.enrollmentId === enrollmentId && a.stepId === nextStep.stepId
            ? { ...a, isCurrentStep: true }
            : a,
        );
      }
      return updated;
    });
  }, []);

  const handleIgnore = useCallback((activity: PendingActivity) => {
    handleActivityDone(activity.enrollmentId, activity.stepId);
    import('../actions/ignore-activity').then(({ ignoreActivity }) =>
      ignoreActivity(activity.enrollmentId).then((r) => {
        if (!r.success) toast.error(r.error);
        else toast.success('Atividade ignorada');
      }),
    );
  }, [handleActivityDone]);

  const handleViewLead = useCallback((leadId: string) => {
    router.push(`/leads/${leadId}`);
  }, [router]);

  const handleLeadWon = useCallback((activity: PendingActivity) => {
    handleActivityDone(activity.enrollmentId, activity.stepId);
    import('@/features/leads/actions/lead-crm').then(({ markLeadAsWon }) =>
      markLeadAsWon(activity.lead.id).then((r: { success: boolean; error?: string }) => {
        if (!r.success) toast.error(r.error);
        else toast.success('Lead marcado como ganho');
      }),
    );
  }, [handleActivityDone]);

  const handleLeadLost = useCallback((activity: PendingActivity) => {
    router.push(`/leads/${activity.lead.id}`);
  }, [router]);

  const handleClose = useCallback(() => {
    setSelectedIndex(null);
  }, []);

  const handleNavigate = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  function findGlobalIndex(activity: PendingActivity) {
    return visibleActivities.findIndex(
      (a) => a.enrollmentId === activity.enrollmentId && a.stepId === activity.stepId,
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListChecks className="h-6 w-6 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <div>
            <h1 className="text-2xl font-bold">Atividades</h1>
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {total} atividade{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-4 w-4" />
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status */}
        <Select
          value={activeStatus}
          onValueChange={(v) => { setOverrides((prev) => ({ ...prev, status: v })); updateParam('status', v); }}
        >
          <SelectTrigger className="w-full sm:w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos status</SelectItem>
            {statusOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Channel */}
        <Select
          value={activeChannel}
          onValueChange={(v) => { setOverrides((prev) => ({ ...prev, channel: v })); updateParam('channel', v); }}
        >
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="Atividade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todas atividades</SelectItem>
            {channelOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Cadence */}
        <Select
          value={cadenceFilter}
          onValueChange={setCadenceFilter}
        >
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Cadência" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas cadências</SelectItem>
            {cadenceOptions.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Step */}
        <Select
          value={stepFilter}
          onValueChange={setStepFilter}
        >
          <SelectTrigger className="w-full sm:w-[110px]">
            <SelectValue placeholder="Passo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos passos</SelectItem>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <SelectItem key={n} value={String(n)}>
                Passo {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Input
            placeholder="Nome, email ou telefone"
            defaultValue={currentSearch}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateParam('search', e.currentTarget.value);
              }
            }}
          />
        </div>
      </div>

      {/* Section label */}
      <div className="rounded-lg bg-[var(--muted)]/50 px-4 py-2">
        <span className="text-sm font-semibold text-[var(--foreground)]">
          Atividades das Cadências ({filtered.length})
        </span>
      </div>

      {/* Table header — must match ACTIVITY_GRID_COLS from ActivityRow */}
      {filtered.length > 0 && (
        <div className="border-b pb-2">
          <div className={`${ACTIVITY_GRID_COLS} gap-4 px-4 text-xs font-medium uppercase text-[var(--muted-foreground)] dark:text-[var(--foreground)]`}>
            <span>Atividade</span>
            <span>Cadência</span>
            <span>Lead</span>
            <span />
          </div>
        </div>
      )}

      {/* Activity list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-[var(--muted)] p-4">
            <SearchX className="h-10 w-10 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">Nenhuma atividade encontrada</h3>
          <p className="max-w-sm text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Tente ajustar os filtros para encontrar o que procura.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {paginatedActivities.map((activity) => (
            <ActivityRow
              key={`${activity.enrollmentId}:${activity.stepId}`}
              activity={activity}
              onExecute={() => setSelectedIndex(findGlobalIndex(activity))}

              onIgnore={() => handleIgnore(activity)}
              onViewLead={() => handleViewLead(activity.lead.id)}
              onLeadWon={() => handleLeadWon(activity)}
              onLeadLost={() => handleLeadLost(activity)}
            />
          ))}
          <ActivityPagination
            total={filtered.length}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={handlePerPageChange}
          />
        </div>
      )}

      {/* Execution Sheet */}
      <ActivityExecutionSheet
        activities={visibleActivities}
        selectedIndex={selectedIndex}
        onClose={handleClose}
        onNavigate={handleNavigate}
        onActivityDone={handleActivityDone}
      />
    </div>
  );
}
