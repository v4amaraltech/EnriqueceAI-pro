import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { getDialerProvider } from '@/features/calls/actions/get-dialer-provider';
import { fetchAvailableLeadsCount } from '@/features/activities/actions/fetch-available-leads-count';
import { fetchDailyProgress } from '@/features/activities/actions/fetch-daily-progress';
import { fetchDialerPreferences } from '@/features/activities/actions/fetch-dialer-preferences';
import { fetchDialerQueue } from '@/features/activities/actions/fetch-dialer-queue';
import { fetchDialerStats } from '@/features/activities/actions/fetch-dialer-stats';
import { fetchPendingActivities } from '@/features/activities/actions/fetch-pending-activities';
import { fetchPendingCalls } from '@/features/activities/actions/fetch-pending-calls';
import { ActivityQueueView } from '@/features/activities';
import { fetchActiveCadenceNames } from '@/features/cadences/actions/fetch-cadence-names';

export default async function AtividadesPage() {
  await requireAuth();

  const [activitiesResult, progressResult, callsResult, dialerResult, availableResult, statsResult, prefsResult, providerResult, cadenceNamesResult] = await Promise.all([
    fetchPendingActivities(),
    fetchDailyProgress(),
    fetchPendingCalls(),
    fetchDialerQueue(),
    fetchAvailableLeadsCount(),
    fetchDialerStats(),
    fetchDialerPreferences(),
    getDialerProvider(),
    fetchActiveCadenceNames(),
  ]);

  if (!activitiesResult.success) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">Atividades</h1>
        <EmptyState
          icon={AlertTriangle}
          title="Erro ao carregar atividades"
          description={activitiesResult.error}
        />
      </div>
    );
  }

  const progressRaw = progressResult.success
    ? progressResult.data
    : { completed: 0, pending: 0, total: 0, target: 20 };

  // Use actual activities count as source of truth to prevent mismatch
  // between progress counter and activity list
  const activitiesCount = activitiesResult.data.length;
  const progress = {
    ...progressRaw,
    pending: activitiesCount,
    total: progressRaw.completed + activitiesCount,
  };

  const pendingCalls = callsResult.success ? callsResult.data : [];
  const dialerQueue = dialerResult.success ? dialerResult.data : [];
  const availableLeads = availableResult.success
    ? availableResult.data
    : { count: 0, leadIds: [] as string[] };
  const dialerStats = statsResult.success ? statsResult.data : undefined;
  const dialerPreferences = prefsResult.success ? prefsResult.data : undefined;
  const dialerProvider = providerResult.success ? providerResult.data.provider : null;
  const cadenceNames = cadenceNamesResult.success ? cadenceNamesResult.data : [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Atividades</h1>
      <ActivityQueueView
        initialActivities={activitiesResult.data}
        progress={progress}
        pendingCalls={pendingCalls}
        dialerQueue={dialerQueue}
        dialerStats={dialerStats}
        dialerPreferences={dialerPreferences}
        dialerProvider={dialerProvider}
        availableLeadsCount={availableLeads.count}
        availableLeadIds={availableLeads.leadIds}
        allCadenceNames={cadenceNames}
      />
    </div>
  );
}
