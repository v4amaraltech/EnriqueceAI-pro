import { AlertTriangle } from 'lucide-react';

import { requireAuth } from '@/lib/auth/require-auth';

import { EmptyState } from '@/shared/components/EmptyState';

import { fetchActiveCadences } from '@/features/leads/actions/fetch-active-cadences';
import { fetchDistinctCanais, fetchDistinctCnaes, fetchLeads, fetchLeadStatusCounts } from '@/features/leads/actions/fetch-leads';
import { getLeadSourceOptions } from '@/features/leads/actions/get-lead-source-options';
import { fetchLeadsCadenceInfo } from '@/features/leads/actions/fetch-leads-cadence-info';
import { fetchOrgMembersAuth } from '@/features/leads/actions/fetch-org-members';
import { fetchUserMap } from '@/features/leads/actions/fetch-user-map';
import { LeadListView } from '@/features/leads/components/LeadListView';

interface LeadsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const user = await requireAuth();

  const params = await searchParams;

  // Build filters from URL search params
  const filters: Record<string, unknown> = {};
  if (params.status) filters.status = params.status;
  if (params.enrichment_status) filters.enrichment_status = params.enrichment_status;
  if (params.porte) filters.porte = params.porte;
  if (params.cnae) filters.cnae = params.cnae;
  if (params.uf) filters.uf = params.uf;
  if (params.lead_source) filters.lead_source = params.lead_source;
  if (params.assigned_to) filters.assigned_to = params.assigned_to;
  if (params.cadence_id) filters.cadence_id = params.cadence_id;
  if (params.canal) filters.canal = params.canal;
  if (params.search) filters.search = params.search;
  if (params.page) filters.page = params.page;
  if (params.per_page) filters.per_page = params.per_page;
  if (params.sort_by) filters.sort_by = params.sort_by;
  if (params.sort_dir) filters.sort_dir = params.sort_dir;

  const hasFilters = !!(params.status || params.enrichment_status || params.porte || params.cnae || params.uf || params.lead_source || params.canal || params.assigned_to || params.cadence_id || params.search);

  const result = await fetchLeads(filters);

  if (!result.success) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Erro ao carregar leads"
        description={result.error}
      />
    );
  }

  // Fetch cadence info and user map in parallel
  const leadIds = result.data.data.map((l) => l.id);
  const uniqueUserIds = [...new Set(
    result.data.data
      .flatMap((l) => [l.assigned_to, l.created_by])
      .filter((id): id is string => id !== null && id !== undefined),
  )];

  const [cadenceResult, userMapResult, membersResult, statusCountsResult, cadencesResult, cnaesResult, leadSourceOptions, canaisResult] = await Promise.all([
    fetchLeadsCadenceInfo(leadIds),
    fetchUserMap(uniqueUserIds),
    fetchOrgMembersAuth(),
    fetchLeadStatusCounts(),
    fetchActiveCadences(),
    fetchDistinctCnaes(),
    getLeadSourceOptions(),
    fetchDistinctCanais(),
  ]);
  const cadenceInfo = cadenceResult.success ? cadenceResult.data : {};
  const userMap = userMapResult.success ? userMapResult.data : {};
  const members = membersResult.success ? membersResult.data : [];
  const statusCounts = statusCountsResult.success ? statusCountsResult.data : undefined;
  const cadences = cadencesResult.success ? cadencesResult.data : [];
  const cnaes = cnaesResult.success ? cnaesResult.data : [];
  const canalOptions = canaisResult.success ? canaisResult.data : [];

  return (
    <LeadListView
      result={result.data}
      hasFilters={hasFilters}
      cadenceInfo={cadenceInfo}
      userMap={userMap}
      currentUserId={user.id}
      members={members}
      statusCounts={statusCounts}
      cadences={cadences}
      cnaes={cnaes}
      leadSourceOptions={leadSourceOptions}
      canalOptions={canalOptions}
    />
  );
}
