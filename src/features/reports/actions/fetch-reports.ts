'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type {
  RawCadence,
  RawEnrollment,
  RawInteraction,
  RawLead,
  RawMember,
  ReportData,
  ReportDateRange,
  ReportPeriod,
} from '../reports.contract';
import {
  calculateCadenceMetrics,
  calculateOverallMetrics,
  calculateSdrMetrics,
} from '../utils/metrics';

function getPeriodDate(period: ReportPeriod): string {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export async function fetchReportData(
  period: ReportPeriod = '30d',
  dateRange?: ReportDateRange,
  sdrId?: string,
  cadenceId?: string,
): Promise<ActionResult<ReportData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const sinceDate = dateRange
    ? `${dateRange.from}T03:00:00Z`
    : getPeriodDate(period);
  const untilDate = dateRange
    ? `${dateRange.to}T23:59:59-03:00`
    : undefined;

  // Fetch org cadence IDs for enrollment isolation (cadence_enrollments has no org_id column)
  const { data: orgCadences } = (await from(supabase, 'cadences')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)) as { data: { id: string }[] | null };
  const orgCadenceIds = cadenceId ? [cadenceId] : (orgCadences ?? []).map((c) => c.id);

  // Build queries with optional upper bound for custom date ranges
  let enrollmentsQuery = from(supabase, 'cadence_enrollments')
    .select('cadence_id, lead_id, status, enrolled_by')
    .in('cadence_id', orgCadenceIds.length > 0 ? orgCadenceIds : ['__none__'])
    .gte('enrolled_at', sinceDate);
  if (untilDate) enrollmentsQuery = enrollmentsQuery.lte('enrolled_at', untilDate);
  if (sdrId) enrollmentsQuery = enrollmentsQuery.eq('enrolled_by', sdrId);

  let interactionsQuery = from(supabase, 'interactions')
    .select('type, cadence_id, lead_id, created_at, performed_by')
    .eq('org_id', orgId)
    .gte('created_at', sinceDate);
  if (untilDate) interactionsQuery = interactionsQuery.lte('created_at', untilDate);
  if (sdrId) interactionsQuery = interactionsQuery.eq('performed_by', sdrId);
  if (cadenceId) interactionsQuery = interactionsQuery.eq('cadence_id', cadenceId);

  // Fetch all data in parallel
  const [cadencesResult, enrollmentsResult, interactionsResult, leadsResult, membersResult] =
    await Promise.all([
      // Active cadences (filter by cadenceId when provided)
      (() => {
        let q = from(supabase, 'cadences')
          .select('id, name')
          .eq('org_id', orgId)
          .is('deleted_at', null);
        if (cadenceId) q = q.eq('id', cadenceId);
        return q;
      })() as unknown as Promise<{ data: RawCadence[] | null }>,

      // Enrollments in period
      enrollmentsQuery as unknown as Promise<{ data: RawEnrollment[] | null }>,

      // Interactions in period
      interactionsQuery as unknown as Promise<{ data: RawInteraction[] | null }>,

      // Leads
      from(supabase, 'leads')
        .select('id, status')
        .eq('org_id', orgId)
        .is('deleted_at', null) as unknown as Promise<{ data: RawLead[] | null }>,

      // Org members (SDRs)
      from(supabase, 'organization_members')
        .select('user_id, user_email')
        .eq('org_id', orgId)
        .eq('status', 'active') as unknown as Promise<{ data: RawMember[] | null }>,
    ]);

  const cadences = cadencesResult.data ?? [];
  const enrollments = enrollmentsResult.data ?? [];
  const interactions = interactionsResult.data ?? [];
  const leads = leadsResult.data ?? [];
  const members = membersResult.data ?? [];

  return {
    success: true,
    data: {
      cadenceMetrics: calculateCadenceMetrics(cadences, enrollments, interactions),
      sdrMetrics: calculateSdrMetrics(members, enrollments, interactions),
      overallMetrics: calculateOverallMetrics(leads, interactions, enrollments),
    },
  };
}
