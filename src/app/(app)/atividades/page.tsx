import { AlertTriangle } from 'lucide-react';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { isManager } from '@/lib/auth/require-manager';

import { EmptyState } from '@/shared/components/EmptyState';

import { fetchOrgMembersAuth, type OrgMemberOption } from '@/features/leads/actions/fetch-org-members';

import { getDialerProvider } from '@/features/calls/actions/get-dialer-provider';
import { fetchActiveProspectingCount } from '@/features/activities/actions/fetch-active-prospecting-count';
import { fetchAvailableLeadsCount } from '@/features/activities/actions/fetch-available-leads-count';
import { fetchDailyProgress } from '@/features/activities/actions/fetch-daily-progress';
import { fetchDialerPreferences } from '@/features/activities/actions/fetch-dialer-preferences';
import { fetchDialerQueue } from '@/features/activities/actions/fetch-dialer-queue';
import { fetchDialerStats } from '@/features/activities/actions/fetch-dialer-stats';
import { fetchPendingActivities } from '@/features/activities/actions/fetch-pending-activities';
import { ActivityQueueView } from '@/features/activities';
import { fetchActiveCadenceNames } from '@/features/cadences/actions/fetch-cadence-names';

export default async function AtividadesPage() {
  await requireAuth();
  const managerFlag = await isManager();

  const [activitiesResult, progressResult, dialerResult, availableResult, activeProspectingResult, statsResult, prefsResult, providerResult, cadenceNamesResult, membersResult] = await Promise.all([
    fetchPendingActivities(),
    fetchDailyProgress(),
    fetchDialerQueue(),
    fetchAvailableLeadsCount(),
    fetchActiveProspectingCount(),
    fetchDialerStats(),
    fetchDialerPreferences(),
    getDialerProvider(),
    fetchActiveCadenceNames(),
    // Only managers need the org-wide member list (for the per-SDR filter);
    // skip the getUserById fan-out for SDRs.
    managerFlag ? fetchOrgMembersAuth() : Promise.resolve<ActionResult<OrgMemberOption[]>>({ success: true, data: [] }),
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

  const dialerQueue = dialerResult.success ? dialerResult.data : [];
  const availableLeads = availableResult.success
    ? availableResult.data
    : { count: 0, leadIds: [] as string[] };
  const activeProspectingCount = activeProspectingResult.success ? activeProspectingResult.data : 0;
  const dialerStats = statsResult.success ? statsResult.data : undefined;
  const dialerPreferences = prefsResult.success ? prefsResult.data : undefined;
  const dialerProvider = providerResult.success ? providerResult.data.provider : null;
  const cadenceNames = cadenceNamesResult.success ? cadenceNamesResult.data : [];
  const members = managerFlag && membersResult.success
    ? membersResult.data.map((m) => ({ userId: m.userId, name: m.name, role: m.role }))
    : [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Atividades</h1>
      <ActivityQueueView
        initialActivities={activitiesResult.data}
        progress={progress}
        dialerQueue={dialerQueue}
        dialerStats={dialerStats}
        dialerPreferences={dialerPreferences}
        dialerProvider={dialerProvider}
        availableLeadsCount={availableLeads.count}
        activeProspectingCount={activeProspectingCount}
        availableLeadIds={availableLeads.leadIds}
        allCadenceNames={cadenceNames}
        isManager={managerFlag}
        members={members}
      />
    </div>
  );
}
