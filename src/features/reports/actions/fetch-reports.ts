'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type {
  RawCadence,
  RawEnrollment,
  RawInteraction,
  RawLead,
  RawMember,
  ReportData,
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
): Promise<ActionResult<ReportData>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const sinceDate = getPeriodDate(period);

  // Fetch all data in parallel
  const [cadencesResult, enrollmentsResult, interactionsResult, leadsResult, membersResult] =
    await Promise.all([
      // Active cadences
      from(supabase, 'cadences')
        .select('id, name')
        .eq('org_id', member.org_id)
        .is('deleted_at', null) as unknown as Promise<{ data: RawCadence[] | null }>,

      // Enrollments in period
      from(supabase, 'cadence_enrollments')
        .select('cadence_id, lead_id, status, enrolled_by')
        .gte('enrolled_at', sinceDate) as unknown as Promise<{ data: RawEnrollment[] | null }>,

      // Interactions in period
      from(supabase, 'interactions')
        .select('type, cadence_id, lead_id, created_at')
        .eq('org_id', member.org_id)
        .gte('created_at', sinceDate) as unknown as Promise<{ data: RawInteraction[] | null }>,

      // Leads
      from(supabase, 'leads')
        .select('id, status')
        .eq('org_id', member.org_id)
        .is('deleted_at', null) as unknown as Promise<{ data: RawLead[] | null }>,

      // Org members (SDRs)
      from(supabase, 'organization_members')
        .select('user_id, user_email')
        .eq('org_id', member.org_id)
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
      overallMetrics: calculateOverallMetrics(leads, interactions),
    },
  };
}
