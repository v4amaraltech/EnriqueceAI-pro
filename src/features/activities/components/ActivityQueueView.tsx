'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';
import { ChevronDown, ListChecks, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import type { DialerProvider } from '@/features/calls/types/dialer-provider';

import type { PendingCallLead } from '../actions/fetch-pending-calls';
import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import type { DailyProgress } from '../actions/fetch-daily-progress';
import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';
import type { PendingActivity } from '../types';
import { OVERDUE_THRESHOLD_HOURS, hoursOverdue } from '../utils/overdue';

import { MarkLeadLostDialog } from '@/features/leads/components/MarkLeadLostDialog';

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
import { ReturnsTab } from './ReturnsTab';
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
  allCadenceNames?: string[];
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
    // Status filter — usa hoursOverdue (clamp pro horário comercial BRT)
    if (filters.status === 'overdue') {
      if (hoursOverdue(a.nextStepDue) < OVERDUE_THRESHOLD_HOURS) return false;
    }
    if (filters.status === 'due') {
      if (hoursOverdue(a.nextStepDue) >= OVERDUE_THRESHOLD_HOURS) return false;
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

export function ActivityQueueView({ initialActivities, progress, pendingCalls, dialerQueue = [], dialerStats, dialerPreferences, dialerProvider = null, showPowerDialer = true, availableLeadsCount = 0, availableLeadIds = [], allCadenceNames = [] }: ActivityQueueViewProps) {
  const router = useRouter();
  const [activities, setActivities] = useState<PendingActivity[]>(initialActivities);
  // Selection is keyed by `${enrollmentId}:${stepId}` (a stable identity) instead of
  // a numeric index. Otherwise, when revalidatePath triggers an RSC re-render that
  // reorders the list (new enrollments arriving on top, scheduled activities, etc.),
  // a numeric selection silently slides to a different lead.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Sync with server data when revalidatePath triggers a re-render with fresh
  // activities — but preserve the SDR's local ordering. Each executeActivity
  // bumps the enrollment's next_step_due, which pushes that lead later in the
  // server's leadEarliestDue ranking. If we replaced the list outright, the SDR
  // would finish ECO RENOVA's first step and then jump to a different lead
  // because ECO RENOVA fell to the bottom on the next refetch. Keep the prev
  // order for activities that still exist on the server, and append new ones.
  useEffect(() => {
    setActivities((prev) => {
      const initialKeys = new Set(initialActivities.map((a) => `${a.enrollmentId}:${a.stepId}`));
      const prevKeys = new Set(prev.map((a) => `${a.enrollmentId}:${a.stepId}`));
      const kept = prev.filter((a) => initialKeys.has(`${a.enrollmentId}:${a.stepId}`));
      const newOnes = initialActivities.filter((a) => !prevKeys.has(`${a.enrollmentId}:${a.stepId}`));
      return [...kept, ...newOnes];
    });
  }, [initialActivities]);
  const [activeTab, setActiveTab] = useState<'execution' | 'returns' | 'dialer'>('execution');
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

  // Centralized lost-lead dialog. Both the post-call panel and ActivityRow's
  // "Perdido" button funnel through this state so the SDR selects a loss reason
  // without leaving the activity queue.
  const [lostDialogActivity, setLostDialogActivity] = useState<PendingActivity | null>(null);

  const handleLeadLost = useCallback((activity: PendingActivity) => {
    setLostDialogActivity(activity);
  }, []);

  const handleLostDialogSuccess = useCallback(() => {
    if (!lostDialogActivity) return;
    const lostKey = keyOf(lostDialogActivity);
    // Resolve the next activity BEFORE handleActivityDone removes the lost one
    // so the sheet can advance instead of rendering empty (used to look like a
    // "black screen" because the sheet stayed open with no inner content).
    const idx = activities.findIndex((a) => keyOf(a) === lostKey);
    const nextActivity = idx >= 0 ? activities[idx + 1] : undefined;

    handleActivityDone(lostDialogActivity.enrollmentId, lostDialogActivity.stepId);
    setLostDialogActivity(null);

    if (selectedKey === lostKey) {
      setSelectedKey(nextActivity ? keyOf(nextActivity) : null);
    }
  }, [lostDialogActivity, handleActivityDone, activities, selectedKey]);

  const handleClose = useCallback(() => {
    setSelectedKey(null);
  }, []);

  const handleNavigate = useCallback((key: string) => {
    setSelectedKey(key);
  }, []);

  const keyOf = (a: PendingActivity) => `${a.enrollmentId}:${a.stepId}`;

  // Show all activities (current + future within 24h window) grouped by lead
  const visibleActivities = useMemo(() => activities, [activities]);

  // Quick mode reorders the navigation so the SDR stays on the same channel
  // across leads (batch mode). Without this, the sheet would navigate
  // [lead A: phone, lead A: whatsapp, lead B: phone, ...] — exactly the
  // opposite of what the "Modo rápido" label promises. We sort by channel
  // first, then preserve the original lead order inside each channel.
  const sheetActivities = useMemo(() => {
    if (!quickMode) return visibleActivities;
    // Map each activity to its position in visibleActivities to preserve
    // the secondary ordering (urgency/lead) inside each channel bucket.
    const originalIndex = new Map<string, number>();
    visibleActivities.forEach((a, idx) => {
      originalIndex.set(`${a.enrollmentId}:${a.stepId}`, idx);
    });
    return [...visibleActivities].sort((a, b) => {
      if (a.channel !== b.channel) return a.channel.localeCompare(b.channel);
      const ai = originalIndex.get(`${a.enrollmentId}:${a.stepId}`) ?? 0;
      const bi = originalIndex.get(`${b.enrollmentId}:${b.stepId}`) ?? 0;
      return ai - bi;
    });
  }, [quickMode, visibleActivities]);

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

  // Auto-open first activity when quick mode is activated. Resolves the
  // first activity from the channel-sorted list so the sheet opens on the
  // top of the first channel bucket (typically email or linkedin given
  // alphabetical order), keeping the "batch by channel" promise consistent
  // from the very first card.
  const handleToggleQuickMode = useCallback(() => {
    const newMode = !quickMode;
    setQuickMode(newMode);
    if (newMode && selectedKey === null) {
      // sheetActivities is recomputed when quickMode flips, but here we
      // re-derive synchronously from filtered to avoid a stale ref.
      const fallback = filtered.find((a) => !a.enrollmentId.startsWith('scheduled:'));
      const byChannel = [...filtered]
        .filter((a) => !a.enrollmentId.startsWith('scheduled:'))
        .sort((a, b) => a.channel.localeCompare(b.channel));
      const first = byChannel[0] ?? fallback;
      if (first) setSelectedKey(`${first.enrollmentId}:${first.stepId}`);
    }
  }, [quickMode, filtered, selectedKey]);

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
  // Show every active cadence in the org-wide list, not just ones currently
  // surfacing activities — otherwise a cadence whose next step is days in the
  // future (e.g. Outbound after the 2/4/6-day delays kick in) disappears from
  // the filter even though the SDR has leads enrolled in it.
  const cadenceOptions = useMemo(
    () => {
      const fromQueue = visibleActivities.map((a) => a.cadenceName.trim());
      const merged = new Set<string>([...allCadenceNames, ...fromQueue]);
      return [...merged].sort();
    },
    [visibleActivities, allCadenceNames],
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
        <button
          type="button"
          onClick={() => setActiveTab('returns')}
          className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
            activeTab === 'returns'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-[var(--foreground)]'
          }`}
        >
          Retornos{scheduledReturns.length > 0 && ` (${scheduledReturns.length})`}
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

      {activeTab === 'returns' ? (
        <>
          <ReturnsTab
            returns={scheduledReturns}
            onExecute={(a) => setSelectedKey(keyOf(a))}
            onIgnore={handleIgnore}
            onViewLead={handleViewLead}
            onLeadWon={handleLeadWon}
            onLeadLost={handleLeadLost}
          />
          <ActivityExecutionSheet
            activities={visibleActivities}
            selectedKey={selectedKey}
            onClose={handleClose}
            onNavigate={handleNavigate}
            onActivityDone={handleActivityDone}
            onLeadLost={handleLeadLost}
            dialerProvider={dialerProvider}
            quickMode={false}
          />
        </>
      ) : activeTab === 'dialer' && showPowerDialer ? (
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
                          onExecute={() => setSelectedKey(keyOf(activity))}

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
                  onExecute={() => setSelectedKey(keyOf(activity))}
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
            activities={sheetActivities}
            selectedKey={selectedKey}
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
      <MarkLeadLostDialog
        leadId={lostDialogActivity?.lead.id ?? ''}
        open={lostDialogActivity !== null}
        onOpenChange={(open) => {
          if (!open) setLostDialogActivity(null);
        }}
        onSuccess={handleLostDialogSuccess}
      />
    </div>
  );
}
