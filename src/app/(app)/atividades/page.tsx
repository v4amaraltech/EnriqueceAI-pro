import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { fetchAvailableLeadsCount } from '@/features/activities/actions/fetch-available-leads-count';
import { fetchDailyProgress } from '@/features/activities/actions/fetch-daily-progress';
import { fetchDialerPreferences } from '@/features/activities/actions/fetch-dialer-preferences';
import { fetchDialerQueue } from '@/features/activities/actions/fetch-dialer-queue';
import { fetchDialerStats } from '@/features/activities/actions/fetch-dialer-stats';
import { fetchPendingActivities } from '@/features/activities/actions/fetch-pending-activities';
import { fetchPendingCalls } from '@/features/activities/actions/fetch-pending-calls';
import { fetchConnections } from '@/features/integrations/actions/fetch-connections';
import { ActivityQueueView } from '@/features/activities';

export default async function AtividadesPage() {
  await requireAuth();

  const [activitiesResult, progressResult, callsResult, dialerResult, availableResult, statsResult, prefsResult, connectionsResult] = await Promise.all([
    fetchPendingActivities(),
    fetchDailyProgress(),
    fetchPendingCalls(),
    fetchDialerQueue(),
    fetchAvailableLeadsCount(),
    fetchDialerStats(),
    fetchDialerPreferences(),
    fetchConnections(),
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

  // Detect call provider: prefer 3CPlus if connected, fallback to API4COM
  let callProvider: 'api4com' | 'threecplus' | null = null;
  if (connectionsResult.success) {
    if (connectionsResult.data.threecplus?.status === 'connected') {
      callProvider = 'threecplus';
    } else if (connectionsResult.data.api4com?.status === 'connected') {
      callProvider = 'api4com';
    }
  }

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
        callProvider={callProvider}
        availableLeadsCount={availableLeads.count}
      />
    </div>
  );
}
