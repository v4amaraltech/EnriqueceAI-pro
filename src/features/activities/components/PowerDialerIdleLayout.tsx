'use client';

import { useCallback, useMemo, useState } from 'react';

import { Phone, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { useOrganization } from '@/features/auth/hooks/useOrganization';
import { Button } from '@/shared/components/ui/button';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import type { DialerPreferences, DialerStats } from '../schemas/dialer-preferences.schemas';

import {
  DialerFilterBar,
  applyDialerFilters,
  defaultDialerFilters,
  type DialerFilterValues,
} from './DialerFilterBar';
import { DialerPreferencesDialog } from './DialerPreferencesDialog';
import { DialerQueueGrid } from './DialerQueueGrid';
import { DialerSidebar } from './DialerSidebar';

interface PowerDialerIdleLayoutProps {
  queue: DialerQueueItem[];
  stats: DialerStats;
  preferences: DialerPreferences;
  onStart: () => void;
  onPreferencesSaved: (updated: DialerPreferences) => void;
}

export function PowerDialerIdleLayout({
  queue,
  stats,
  preferences,
  onStart,
  onPreferencesSaved,
}: PowerDialerIdleLayoutProps) {
  const { isManager } = useOrganization();
  const router = useRouter();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [filters, setFilters] = useState<DialerFilterValues>(defaultDialerFilters);

  const filteredQueue = useMemo(
    () => applyDialerFilters(queue, filters),
    [queue, filters],
  );

  const handleViewLead = useCallback(
    (leadId: string) => {
      router.push(`/leads/${leadId}`);
    },
    [router],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900">
            <Phone className="h-5 w-5 text-green-700 dark:text-green-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Power Dialer</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Discador automatico para acelerar suas ligacoes
            </p>
          </div>
        </div>

        <Button
          onClick={onStart}
          disabled={queue.length === 0}
          className="gap-2 bg-green-600 hover:bg-green-700"
        >
          <Play className="h-4 w-4" />
          Iniciar ligacoes
        </Button>
      </div>

      {/* Layout: sidebar + main */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <DialerSidebar
          preferences={preferences}
          stats={stats}
          isManager={isManager}
          onEditPreferences={() => setPrefsOpen(true)}
        />

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Filters */}
          <DialerFilterBar
            queue={queue}
            filters={filters}
            onFiltersChange={setFilters}
          />

          {/* Grid */}
          <DialerQueueGrid
            items={filteredQueue}
            totalCount={queue.length}
            onViewLead={handleViewLead}
          />
        </div>
      </div>

      {/* Preferences dialog */}
      <DialerPreferencesDialog
        open={prefsOpen}
        onOpenChange={setPrefsOpen}
        preferences={preferences}
        onSaved={onPreferencesSaved}
      />
    </div>
  );
}
