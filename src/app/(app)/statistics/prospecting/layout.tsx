import { requireManager } from '@/lib/auth/require-manager';

import { fetchActiveCadenceOptions } from '@/features/statistics/actions/fetch-active-cadence-options';
import { fetchOrgMembers } from '@/features/statistics/actions/shared';
import { ProspectingSidebarFilters } from '@/features/statistics/components/ProspectingSidebarFilters';
import { ProspectingSidebarNav } from '@/features/statistics/components/ProspectingSidebarNav';

export default async function ProspectingStatisticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManager();

  const [members, cadences] = await Promise.all([
    fetchOrgMembers(),
    fetchActiveCadenceOptions(),
  ]);

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 space-y-5 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <ProspectingSidebarFilters members={members} cadences={cadences} />
        <hr className="border-[var(--border)]" />
        <ProspectingSidebarNav />
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
