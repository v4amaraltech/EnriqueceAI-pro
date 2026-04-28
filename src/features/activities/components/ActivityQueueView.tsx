'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';
import { CalendarClock, ChevronDown, ListChecks, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import type { DialerProvider } from '@/features/calls/types/dialer-provider';

import type { PendingCallLead } from '../actions/fetch-pending-calls';
import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import type { DailyProgress } from '../actions/fetch-daily-progress';
import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';
import type { PendingActivity } from '../types';

import { ActivityEmptyState } from './ActivityEmptyState';
import { ActivityExecutionSheet } from './ActivityExecutionSheet';
import {
  ActivityFilters,
  defaultFilters,
  type ActivityFilterValues,
} from './ActivityFilters';
import { ActivityPagination } from './ActivityPagination';
import { ActivityRow, ACTIVITY_GRID_COLS } from './ActivityRow';
import { PendingCallsSection } from './PendingCallsSection';
import { PowerDialerTab } from './PowerDialerTab';
import { ProgressCard } from './ProgressCard';
import { StartNewLeadsModal } from './StartNewLeadsModal';

interface ActivityQueueViewProps {
  initialActivities: PendingActivity[];
  progress: DailyProgress;
  pendingCalls: PendingCallLead[];
  dialerQueue?: DialerQueueItem[];
  dialerStats?: DialerStats;
  dialerPreferences?: DialerPreferences;
  dialerProvider?: DialerProvider;
  showPowerDialer?: boolean;
  availableLeadsCount?: number;
  availableLeadIds?: string[];
}

const channelGroupLabel: Record<string, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  phone: 'Ligação',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
};

const DEFAULT_PER_PAGE = 25;

function applyFilters(activities: PendingActivity[], filters: ActivityFilterValues): PendingActivity[] {
  return activities.filter((a) => {
    // Status filter
    if (filters.status === 'overdue') {
      const diffH = (Date.now() - new Date(a.nextStepDue).getTime()) / 3600000;
      if (diffH < 1) return false;
    }
    if (filters.status === 'due') {
      const diffH = (Date.now() - new Date(a.nextStepDue).getTime()) / 3600000;
      if (diffH >= 1) return false;
    }

    // Channel
    if (filters.channel !== 'all' && a.channel !== filters.channel) return false;

    // Cadence
    if (filters.cadence !== 'all' && a.cadenceName !== filters.cadence) return false;

    // Step
    if (filters.step !== 'all' && String(a.stepOrder) !== filters.step) return false;

    // Search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const leadName = (a.lead.nome_fantasia ?? a.lead.razao_social ?? a.lead.cnpj).toLowerCase();
      const cadence = a.cadenceName.toLowerCase();
      if (!leadName.includes(q) && !cadence.includes(q)) return false;
    }

    return true;
  });
}

const defaultStats: DialerStats = { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 };
const defaultPrefs: DialerPreferences = { simultaneous_phones: 2, daily_limit_per_lead: 3 };

export function ActivityQueueView({ initialActivities, progress, pendingCalls, dialerQueue = [], dialerStats, dialerPreferences, dialerProvider = null, showPowerDialer = true, availableLeadsCount = 0, availableLeadIds = [] }: ActivityQueueViewProps) {
  const router = useRouter();
  const [activities, setActivities] = useState<PendingActivity[]>(initialActivities);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Sync with server data when revalidatePath triggers a re-render with fresh activities
  useEffect(() => {
    setActivities(initialActivities);
  }, [initialActivities]);
  const [activeTab, setActiveTab] = useState<'execution' | 'dialer'>('execution');
  const [quickMode, setQuickMode] = useState(false);
  const [filters, setFilters] = useState<ActivityFilterValues>(defaultFilters);
  const [startNewLeadsOpen, setStartNewLeadsOpen] = useState(false);

  // Pagination state
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);

  const handleActivityDone = useCallback((enrollmentId: string, stepId: string) => {
    setActivities((prev) =>
      prev.filter((a) => !(a.enrollmentId === enrollmentId && a.stepId === stepId)),
    );
  }, []);

  const handleIgnore = useCallback((activity: PendingActivity) => {
    handleActivityDone(activity.enrollmentId, activity.stepId);
    if (activity.enrollmentId.startsWith('scheduled:')) {
      const scheduledId = activity.stepId;
      import('../actions/complete-scheduled-activity').then(({ completeScheduledActivity }) =>
        completeScheduledActivity(scheduledId, 'cancelled').then((r) => {
          if (!r.success) toast.error(r.error);
          else toast.success('Atividade agendada cancelada');
        }),
      );
    } else {
      import('../actions/ignore-activity').then(({ ignoreActivity }) =>
        ignoreActivity(activity.enrollmentId).then((r) => {
          if (!r.success) toast.error(r.error);
          else toast.success('Atividade ignorada');
        }),
      );
    }
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

  // Show all activities (current + future within 24h window) grouped by lead
  const visibleActivities = useMemo(() => activities, [activities]);

  // Unique leads being prospected
  const prospectingLeadsCount = useMemo(() => new Set(activities.map((a) => a.lead.id)).size, [activities]);

  // Separate scheduled returns from cadence activities
  const scheduledReturns = useMemo(
    () => visibleActivities.filter((a) => a.enrollmentId.startsWith('scheduled:')),
    [visibleActivities],
  );
  const cadenceActivities = useMemo(
    () => visibleActivities.filter((a) => !a.enrollmentId.startsWith('scheduled:')),
    [visibleActivities],
  );

  // Filtered activities (cadence only — retornos are always shown separately)
  const filtered = useMemo(() => applyFilters(cadenceActivities, filters), [cadenceActivities, filters]);

  // Auto-open first activity when quick mode is activated
  const handleToggleQuickMode = useCallback(() => {
    const newMode = !quickMode;
    setQuickMode(newMode);
    if (newMode && filtered.length > 0 && selectedIndex === null) {
      setSelectedIndex(0);
    }
  }, [quickMode, filtered.length, selectedIndex]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Paginated slice of filtered activities
  const paginatedActivities = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const handlePerPageChange = useCallback((newPerPage: number) => {
    setPerPage(newPerPage);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    // Scroll to activity list top on page change
    document.getElementById('activity-list-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Cadence options for filter (from visible activities only, trimmed to avoid duplicates)
  const cadenceOptions = useMemo(
    () => [...new Set(visibleActivities.map((a) => a.cadenceName.trim()))].sort(),
    [visibleActivities],
  );

  // Grouped by channel for quick mode (uses paginated slice)
  const grouped = useMemo(() => {
    if (!quickMode) return null;
    const groups = new Map<string, PendingActivity[]>();
    for (const a of paginatedActivities) {
      const list = groups.get(a.channel) ?? [];
      list.push(a);
      groups.set(a.channel, list);
    }
    return groups;
  }, [quickMode, paginatedActivities]);

  // Collapsed state for quick mode groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(channel: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }

  // Find index in visible activities array for execution sheet
  function findGlobalIndex(activity: PendingActivity) {
    return visibleActivities.findIndex(
      (a) => a.enrollmentId === activity.enrollmentId && a.stepId === activity.stepId,
    );
  }

  return (
    <div className="space-y-6">
      {/* Prospecting banner */}
      <div className="flex items-center justify-between rounded-lg border bg-[var(--card)] px-6 py-4">
        <p className="text-sm">
          Você está prospectando <span className="font-semibold text-emerald-600">{prospectingLeadsCount} leads</span> e existem <span className="font-semibold text-emerald-600">{availableLeadsCount} leads disponíveis</span> para serem iniciados
        </p>
        <Button
          size="sm"
          className="bg-emerald-500 hover:bg-emerald-600 text-white shrink-0"
          onClick={() => setStartNewLeadsOpen(true)}
        >
          Iniciar novos leads
        </Button>
      </div>

      {/* Progress card */}
      <ProgressCard
        completed={progress.completed}
        total={progress.total}
        target={progress.target}
        availableLeadIds={availableLeadIds}
      />

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b">
        <button
          type="button"
          onClick={() => setActiveTab('execution')}
          className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
            activeTab === 'execution'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          Execução
        </button>
        {showPowerDialer && (
          <button
            type="button"
            onClick={() => setActiveTab('dialer')}
            className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
              activeTab === 'dialer'
                ? 'border-[var(--primary)] text-[var(--primary)]'
                : 'border-transparent text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Power Dialer
          </button>
        )}
      </div>

      {activeTab === 'dialer' && showPowerDialer ? (
        <PowerDialerTab
          initialQueue={dialerQueue}
          stats={dialerStats ?? defaultStats}
          preferences={dialerPreferences ?? defaultPrefs}
          dialerProvider={dialerProvider}
        />
      ) : (
        <>
          {/* Pending calls section */}
          <PendingCallsSection leads={pendingCalls} />

          {/* Scheduled returns section — always visible at the top */}
          {scheduledReturns.length > 0 && (
            <div className="rounded-lg border-2 border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-500/20">
                <CalendarClock className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Retornos agendados ({scheduledReturns.length})
                </h2>
              </div>
              <div className="space-y-2 p-2">
                {scheduledReturns.map((activity) => (
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
              </div>
            </div>
          )}

          {/* Filters + Quick mode toggle */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ActivityFilters
              filters={filters}
              onFiltersChange={setFilters}
              cadenceOptions={cadenceOptions}
            />
            <Button
              variant={quickMode ? 'default' : 'outline'}
              size="sm"
              onClick={handleToggleQuickMode}
              className="gap-1.5 shrink-0"
            >
              <Zap className="h-3.5 w-3.5" />
              Modo Execução rápida
            </Button>
          </div>

          {/* Column headers */}
          <div id="activity-list-top">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="h-5 w-5 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
              <h2 className="text-lg font-semibold">
                Atividades das Cadências ({filtered.length})
              </h2>
            </div>
            {filtered.length > 0 && (
              <div className={`${ACTIVITY_GRID_COLS} items-center gap-4 border-b border-[var(--border)] px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]`}>
                <span>Atividade</span>
                <span>Cadência</span>
                <span>Lead</span>
                <span />
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <ActivityEmptyState onStartActivities={() => router.push('/leads')} />
          ) : quickMode && grouped ? (
            /* Quick mode: grouped by channel */
            <div className="space-y-4">
              {[...grouped.entries()].map(([channel, items]) => (
                <div key={channel} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() => toggleGroup(channel)}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-[var(--accent)]/50"
                  >
                    <span>{channelGroupLabel[channel] ?? channel} ({items.length})</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${collapsedGroups.has(channel) ? '-rotate-180' : ''}`} />
                  </button>
                  {!collapsedGroups.has(channel) && (
                    <div className="space-y-2 p-2">
                      {items.map((activity) => (
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
                    </div>
                  )}
                </div>
              ))}
              <ActivityPagination
                total={filtered.length}
                page={page}
                perPage={perPage}
                onPageChange={handlePageChange}
                onPerPageChange={handlePerPageChange}
              />
            </div>
          ) : (
            /* Normal mode: flat list with pagination */
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
                onPageChange={handlePageChange}
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
            onLeadLost={handleLeadLost}
            dialerProvider={dialerProvider}
            quickMode={quickMode}
          />
        </>
      )}
      <StartNewLeadsModal open={startNewLeadsOpen} onOpenChange={setStartNewLeadsOpen} />
    </div>
  );
}
