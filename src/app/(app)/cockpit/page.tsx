import { AlertTriangle } from 'lucide-react';

import { EmptyState } from '@/shared/components/EmptyState';

import { fetchDailyProgress } from '@/features/activities/actions/fetch-daily-progress';
import { fetchPendingActivities } from '@/features/activities/actions/fetch-pending-activities';
import { EMPTY_GUARDRAILS } from '@/features/activities/utils/daily-guardrails';
import { getDialerProvider } from '@/features/calls/actions/get-dialer-provider';
import { isCallLeadCardEnabled } from '@/features/cockpit/services/call-lead-card-flag';
import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from '@/features/cockpit/services/cockpit-auto-dial-flag';
import { ClosersTab } from '@/features/cockpit/components/ClosersTab';
import { CockpitShell } from '@/features/cockpit/components/CockpitShell';
import { fetchCockpitClosers } from '@/features/cockpit/services/cockpit-closers.service';
import { DashboardTab } from '@/features/cockpit/components/DashboardTab';
import { GoalsHistoryTab } from '@/features/cockpit/components/GoalsHistoryTab';
import { fetchCockpitGoals } from '@/features/cockpit/services/cockpit-goals.service';
import { DialerTab } from '@/features/cockpit/components/DialerTab';
import { LeadsTab } from '@/features/cockpit/components/LeadsTab';
import { TasksTab } from '@/features/cockpit/components/TasksTab';
import { fetchCockpitLeads } from '@/features/cockpit/services/cockpit-leads.service';
import { resolveCockpitViewer } from '@/features/cockpit/services/resolve-cockpit-viewer';
import type { CockpitTab, CockpitViewer } from '@/features/cockpit/types';
import { parseCockpitTab } from '@/features/cockpit/utils/cockpit-target';
import { parseLeadsPerPage } from '@/features/cockpit/utils/leads-per-page';
import { parsePortfolioFilters } from '@/features/cockpit/utils/portfolio-period';
import { isMonth } from '@/features/cockpit/utils/month';
import { getSdrPaceData } from '@/features/dashboard/actions/get-sdr-pace-data';
import { currentMonthBrt } from '@/features/dashboard/utils/brt-now';
import { fetchCockpit } from '@/features/whatsapp-auto-send/actions/fetch-cockpit';

export const dynamic = 'force-dynamic';

interface CockpitPageProps {
  searchParams: Promise<{
    tab?: string;
    sdr?: string;
    month?: string;
    q?: string;
    page?: string;
    per_page?: string;
    skip?: string;
    period?: string;
    from?: string;
    to?: string;
    stage?: string;
  }>;
}

export default async function CockpitPage({ searchParams }: CockpitPageProps) {
  const params = await searchParams;
  const requestedTab = parseCockpitTab(params.tab);
  const viewer = await resolveCockpitViewer(params.sdr);
  // Aba "Discador" (motor): só para o próprio usuário e só com as flags do motor. Sem flag, o item do menu
  // segue levando à Execução e `?tab=discador` cai na aba padrão.
  const dialerTabEnabled = await isDialerTabEnabled(viewer);
  const tab = requestedTab === 'discador' && !dialerTabEnabled ? 'tarefas' : requestedTab;

  return (
    <CockpitShell viewer={viewer} tab={tab} dialerTabEnabled={dialerTabEnabled}>
      <CockpitTabContent tab={tab} viewer={viewer} params={params} />
    </CockpitShell>
  );
}

async function isDialerTabEnabled(viewer: CockpitViewer): Promise<boolean> {
  if (viewer.viewerId !== viewer.targetUserId) return false;
  return isCockpitAutoDialEnabled({ orgId: viewer.orgId, userId: viewer.viewerId }).catch(() => false);
}

async function DialerTabServer({ viewer }: { viewer: CockpitViewer }) {
  const scope = { orgId: viewer.orgId, userId: viewer.viewerId };
  const [live, leadCardEnabled] = await Promise.all([
    isCockpitAutoDialLive(scope).catch(() => false),
    isCallLeadCardEnabled(viewer.orgId).catch(() => false),
  ]);
  return <DialerTab autoDial={{ enabled: true, live }} leadCardEnabled={leadCardEnabled} />;
}

type CockpitParams = Awaited<CockpitPageProps['searchParams']>;

async function CockpitTabContent({ tab, viewer, params }: { tab: CockpitTab; viewer: CockpitViewer; params: CockpitParams }) {
  switch (tab) {
    case 'tarefas':
      return <TasksTabServer viewer={viewer} />;
    case 'leads':
      return <LeadsTabServer viewer={viewer} params={params} />;
    case 'metas':
      return <GoalsTabServer viewer={viewer} month={resolveMonth(params.month)} />;
    case 'closers':
      return <ClosersTabServer viewer={viewer} month={resolveMonth(params.month)} />;
    case 'dashboard':
      return <DashboardTabServer viewer={viewer} month={resolveMonth(params.month)} />;
    case 'discador':
      return <DialerTabServer viewer={viewer} />;
  }
}

async function TasksTabServer({ viewer }: { viewer: CockpitViewer }) {
  const isOwn = viewer.targetUserId === viewer.viewerId;
  const leadCardEnabled = await isCallLeadCardEnabled(viewer.orgId);
  const [activitiesResult, progressResult, autoSendResult, providerResult] = await Promise.all([
    fetchPendingActivities({ assignedTo: viewer.targetUserId, includeLeadCard: leadCardEnabled }),
    fetchDailyProgress(isOwn ? undefined : viewer.targetUserId, { includePending: false }),
    fetchCockpit(),
    getDialerProvider(),
  ]);

  if (!activitiesResult.success) {
    return <EmptyState icon={AlertTriangle} title="Erro ao carregar tarefas" description={activitiesResult.error} />;
  }

  // A fila já vem escopada pelo dono; o filtro garante o SDR exibido.
  const activities = activitiesResult.data.filter((a) => a.lead.assigned_to === viewer.targetUserId);

  const progressRaw = progressResult.success
    ? progressResult.data
    : { completed: 0, pending: 0, total: 0, target: 20, guardrails: EMPTY_GUARDRAILS };
  const progress = { ...progressRaw, pending: activities.length, total: progressRaw.completed + activities.length };

  const autoSend = autoSendResult.success
    ? {
        ...autoSendResult.data,
        numbers: autoSendResult.data.numbers.filter((n) => n.userId === viewer.targetUserId),
        queue: autoSendResult.data.queue.filter((q) => q.userId === viewer.targetUserId),
      }
    : null;

  return (
    <TasksTab
      initialActivities={activities}
      progress={progress}
      autoSend={autoSend}
      isOwn={isOwn}
      dialerProvider={providerResult.success ? providerResult.data.provider : null}
      targetUserId={viewer.targetUserId}
      leadCardEnabled={leadCardEnabled}
    />
  );
}


async function LeadsTabServer({ viewer, params }: { viewer: CockpitViewer; params: CockpitParams }) {
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const perPage = parseLeadsPerPage(params.per_page);
  const search = (params.q ?? '').trim();
  const filters = parsePortfolioFilters(params);
  const result = await fetchCockpitLeads({
    orgId: viewer.orgId,
    userId: viewer.targetUserId,
    page,
    perPage,
    search,
    filters,
  });

  if (!result.success) {
    return <EmptyState icon={AlertTriangle} title="Erro ao carregar leads" description={result.error} />;
  }

  return (
    <LeadsTab
      key={`${viewer.targetUserId}:${search}:${filters.period ?? ''}:${filters.stage ?? ''}:${filters.from ?? ''}:${filters.to ?? ''}`}
      data={result.data}
      search={search}
      filters={filters}
    />
  );
}

/** Mês pedido (`YYYY-MM`) sem passar do atual; padrão = mês atual em BRT. */
function resolveMonth(value: string | undefined): string {
  const current = currentMonthBrt();
  return isMonth(value) && value <= current ? value : current;
}

async function DashboardTabServer({ viewer, month }: { viewer: CockpitViewer; month: string }) {
  // Gestor no próprio Cockpit: ele não é SDR e `getSdrPaceData` cairia no 1º SDR (números de outra pessoa).
  if (viewer.isManager && viewer.targetUserId === viewer.viewerId) {
    return <DashboardTab month={month} maxMonth={currentMonthBrt()} sdrPace={null} managerOwn />;
  }
  const paceResult = await getSdrPaceData({ month, userId: viewer.targetUserId }).catch(() => null);

  return (
    <DashboardTab
      month={month}
      maxMonth={currentMonthBrt()}
      sdrPace={paceResult?.success ? paceResult.data : null}
    />
  );
}

async function GoalsTabServer({ viewer, month }: { viewer: CockpitViewer; month: string }) {
  const data = await fetchCockpitGoals(viewer.orgId, viewer.targetUserId, month).catch((error: unknown) => {
    console.error('[cockpit] metas:', error);
    return null;
  });
  if (!data) {
    return <EmptyState icon={AlertTriangle} title="Erro ao carregar metas" description="Tente de novo em instantes." />;
  }
  return <GoalsHistoryTab data={data} maxMonth={currentMonthBrt()} canEditGoals={viewer.isManager} />;
}

async function ClosersTabServer({ viewer, month }: { viewer: CockpitViewer; month: string }) {
  const data = await fetchCockpitClosers(viewer.orgId, month).catch((error: unknown) => {
    console.error('[cockpit] closers:', error);
    return null;
  });
  if (!data) {
    return <EmptyState icon={AlertTriangle} title="Erro ao carregar closers" description="Tente de novo em instantes." />;
  }
  return <ClosersTab key={month} data={data} maxMonth={currentMonthBrt()} canToggle={viewer.isManager} />;
}
