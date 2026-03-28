import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { CONVERSION_COLORS } from '@/shared/constants/chart-colors';

import type {
  CadenceConversionRow,
  ConversionAnalyticsData,
  ConversionByOriginEntry,
  FunnelStage,
  PipelineVelocity,
  StageConversion,
} from '../types/conversion-analytics.types';
import type { EnrollmentQueryRow, InteractionQueryRow, LeadQueryRow } from '../types/query-rows';
import { groupBy, safeRate } from '../types/shared';

interface CadenceRow {
  id: string;
  name: string;
}

export async function fetchConversionAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
): Promise<ConversionAnalyticsData> {
  // Fetch leads
  let leadsQuery = from(supabase, 'leads')
    .select('id, status, created_at, created_by')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (userIds && userIds.length > 0) {
    leadsQuery = leadsQuery.in('created_by', userIds);
  }

  const { data: rawLeads } = (await leadsQuery) as { data: LeadQueryRow[] | null };
  const leads = rawLeads ?? [];

  // Fetch interactions
  let intQuery = from(supabase, 'interactions')
    .select('type, lead_id, cadence_id, created_at')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (cadenceId) {
    intQuery = intQuery.eq('cadence_id', cadenceId);
  }

  const { data: rawInteractions } = (await intQuery) as { data: InteractionQueryRow[] | null };
  const interactions = rawInteractions ?? [];

  // Fetch enrollments
  let enrQuery = from(supabase, 'cadence_enrollments')
    .select('cadence_id, lead_id, status, enrolled_by, created_at, updated_at')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (userIds && userIds.length > 0) {
    enrQuery = enrQuery.in('enrolled_by', userIds);
  }
  if (cadenceId) {
    enrQuery = enrQuery.eq('cadence_id', cadenceId);
  }

  const { data: rawEnrollments } = (await enrQuery) as { data: EnrollmentQueryRow[] | null };
  const enrollments = rawEnrollments ?? [];

  // Fetch cadences
  const { data: rawCadences } = (await from(supabase, 'cadences')
    .select('id, name')
    .eq('org_id', orgId)) as { data: CadenceRow[] | null };
  const cadences = rawCadences ?? [];

  const funnel = calculateFunnel(leads, interactions);
  const stageConversions = calculateStageConversions(funnel);
  const velocity = calculateVelocity(enrollments, leads);
  const cadenceConversion = calculateCadenceConversion(cadences, enrollments, interactions, leads);
  const conversionByOrigin = calculateConversionByOrigin(leads);

  return { funnel, stageConversions, velocity, cadenceConversion, conversionByOrigin };
}

function calculateFunnel(leads: LeadQueryRow[], interactions: InteractionQueryRow[]): FunnelStage[] {
  const totalLeads = leads.length;
  const contactedLeads = new Set(
    interactions.filter((i) => i.type === 'sent').map((i) => i.lead_id),
  );
  const repliedLeads = new Set(
    interactions.filter((i) => i.type === 'replied').map((i) => i.lead_id),
  );
  const meetingLeads = new Set(
    interactions.filter((i) => i.type === 'meeting_scheduled').map((i) => i.lead_id),
  );
  const qualifiedLeads = leads.filter((l) => l.status === 'qualified').length;

  return [
    { label: 'Total Leads', count: totalLeads, percentage: 100, color: CONVERSION_COLORS.totalLeads },
    { label: 'Contactados', count: contactedLeads.size, percentage: safeRate(contactedLeads.size, totalLeads), color: CONVERSION_COLORS.contacted },
    { label: 'Respondidos', count: repliedLeads.size, percentage: safeRate(repliedLeads.size, totalLeads), color: CONVERSION_COLORS.replied },
    { label: 'Reunião', count: meetingLeads.size, percentage: safeRate(meetingLeads.size, totalLeads), color: CONVERSION_COLORS.meeting },
    { label: 'Qualificados', count: qualifiedLeads, percentage: safeRate(qualifiedLeads, totalLeads), color: CONVERSION_COLORS.qualified },
  ];
}

function calculateStageConversions(funnel: FunnelStage[]): StageConversion[] {
  const result: StageConversion[] = [];
  for (let i = 0; i < funnel.length - 1; i++) {
    const from = funnel[i]!;
    const to = funnel[i + 1]!;
    result.push({
      from: from.label,
      to: to.label,
      rate: safeRate(to.count, from.count),
      numerator: to.count,
      denominator: from.count,
    });
  }
  return result;
}

function calculateVelocity(enrollments: EnrollmentQueryRow[], leads: LeadQueryRow[]): PipelineVelocity {
  const qualifiedLeadIds = new Set(
    leads.filter((l) => l.status === 'qualified').map((l) => l.id),
  );

  const durations: number[] = [];
  for (const enrollment of enrollments) {
    if (qualifiedLeadIds.has(enrollment.lead_id)) {
      const startDate = new Date(enrollment.created_at);
      const endDate = new Date(enrollment.updated_at);
      const days = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
      if (days >= 0) durations.push(days);
    }
  }

  if (durations.length === 0) {
    return { avgDaysToQualification: 0, medianDaysToQualification: 0, totalQualified: 0 };
  }

  durations.sort((a, b) => a - b);
  const avg = Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10;
  const mid = Math.floor(durations.length / 2);
  const median = durations.length % 2 === 0
    ? Math.round(((durations[mid - 1]! + durations[mid]!) / 2) * 10) / 10
    : Math.round(durations[mid]! * 10) / 10;

  return {
    avgDaysToQualification: avg,
    medianDaysToQualification: median,
    totalQualified: durations.length,
  };
}

function calculateCadenceConversion(
  cadences: CadenceRow[],
  enrollments: EnrollmentQueryRow[],
  interactions: InteractionQueryRow[],
  leads: LeadQueryRow[],
): CadenceConversionRow[] {
  const qualifiedLeadIds = new Set(
    leads.filter((l) => l.status === 'qualified').map((l) => l.id),
  );

  const enrollmentsByCadence = groupBy(enrollments, (e) => e.cadence_id);
  const interactionsByCadence = groupBy(interactions, (i) => i.cadence_id ?? '');

  return cadences
    .map((cadence) => {
      const cadenceEnrollments = enrollmentsByCadence.get(cadence.id) ?? [];
      const cadenceInteractions = interactionsByCadence.get(cadence.id) ?? [];

      const replies = cadenceInteractions.filter((i) => i.type === 'replied').length;
      const meetings = cadenceInteractions.filter((i) => i.type === 'meeting_scheduled').length;

      const cadenceLeadIds = new Set(cadenceEnrollments.map((e) => e.lead_id));
      const qualified = [...cadenceLeadIds].filter((id) => qualifiedLeadIds.has(id)).length;

      return {
        cadenceId: cadence.id,
        cadenceName: cadence.name,
        enrollments: cadenceEnrollments.length,
        replies,
        meetings,
        qualified,
        conversionRate: safeRate(qualified, cadenceEnrollments.length),
      };
    })
    .filter((c) => c.enrollments > 0)
    .sort((a, b) => b.conversionRate - a.conversionRate);
}

function calculateConversionByOrigin(leads: LeadQueryRow[]): ConversionByOriginEntry[] {
  const originMap = new Map<string, { qualified: number; total: number }>();

  for (const lead of leads) {
    const origin = (lead.created_by ? 'SDR' : 'Import');
    const entry = originMap.get(origin) ?? { qualified: 0, total: 0 };
    entry.total++;
    if (lead.status === 'qualified') entry.qualified++;
    originMap.set(origin, entry);
  }

  return Array.from(originMap.entries()).map(([origin, data]) => ({
    origin,
    qualified: data.qualified,
    unqualified: data.total - data.qualified,
    total: data.total,
    conversionRate: safeRate(data.qualified, data.total),
  }));
}
