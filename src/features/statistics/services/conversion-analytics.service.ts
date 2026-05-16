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
  // Universe = leads created in the period ∪ leads touched by any interaction
  // in the period. Without this, "Contactados" could count interactions on
  // leads from previous periods, producing >100% conversion ratios.
  let periodLeadsQuery = from(supabase, 'leads')
    .select('id, status, created_at, created_by')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (userIds && userIds.length > 0) {
    periodLeadsQuery = periodLeadsQuery.in('created_by', userIds);
  }

  const { data: rawPeriodLeads } = (await periodLeadsQuery.limit(10000)) as { data: LeadQueryRow[] | null };
  const periodLeads = rawPeriodLeads ?? [];

  let intQuery = from(supabase, 'interactions')
    .select('type, lead_id, cadence_id, created_at')
    .eq('org_id', orgId)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd);

  if (cadenceId) {
    intQuery = intQuery.eq('cadence_id', cadenceId);
  }

  const { data: rawInteractions } = (await intQuery.limit(10000)) as { data: InteractionQueryRow[] | null };
  const allInteractions = rawInteractions ?? [];

  const periodLeadIds = new Set(periodLeads.map((l) => l.id));
  const touchedOnlyIds = Array.from(
    new Set(allInteractions.map((i) => i.lead_id).filter((id) => !periodLeadIds.has(id))),
  );

  let touchedLeads: LeadQueryRow[] = [];
  if (touchedOnlyIds.length > 0) {
    let touchedQuery = from(supabase, 'leads')
      .select('id, status, created_at, created_by')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('id', touchedOnlyIds);

    if (userIds && userIds.length > 0) {
      touchedQuery = touchedQuery.in('created_by', userIds);
    }

    const { data: rawTouched } = (await touchedQuery.limit(10000)) as { data: LeadQueryRow[] | null };
    touchedLeads = rawTouched ?? [];
  }

  const leadsMap = new Map<string, LeadQueryRow>();
  for (const l of periodLeads) leadsMap.set(l.id, l);
  for (const l of touchedLeads) leadsMap.set(l.id, l);
  const leads = Array.from(leadsMap.values());

  // Drop interactions whose leads were filtered out (SDR filter, deleted, etc.)
  const universeIds = new Set(leads.map((l) => l.id));
  const interactions = allInteractions.filter((i) => universeIds.has(i.lead_id));

  // Fetch cadences first (for org isolation of enrollments)
  const { data: rawCadences } = (await from(supabase, 'cadences')
    .select('id, name')
    .eq('org_id', orgId)
    .is('deleted_at', null)) as { data: CadenceRow[] | null };
  const cadences = rawCadences ?? [];

  // Fetch enrollments scoped via org cadences (cadence_enrollments has no org_id column).
  // Period-filtered: used by velocity calculation, which needs enrolled_at/updated_at
  // duration on enrollments started in the period.
  const cadenceIds = cadenceId ? [cadenceId] : cadences.map((c) => c.id);
  let enrQuery = from(supabase, 'cadence_enrollments')
    .select('cadence_id, lead_id, status, enrolled_by, enrolled_at, updated_at')
    .in('cadence_id', cadenceIds.length > 0 ? cadenceIds : ['__none__'])
    .gte('enrolled_at', periodStart)
    .lte('enrolled_at', periodEnd);

  if (userIds && userIds.length > 0) {
    enrQuery = enrQuery.in('enrolled_by', userIds);
  }

  const { data: rawEnrollments } = (await enrQuery.limit(10000)) as { data: EnrollmentQueryRow[] | null };
  const enrollments = rawEnrollments ?? [];

  // Cadence membership for every universe lead, regardless of when they enrolled.
  // Without this, leads enrolled before the period but qualified/won inside it
  // wouldn't be attributed to their cadence in the "Conversão por Cadência" table.
  const universeLeadIdsList = Array.from(universeIds);
  let memberships: Array<{ cadence_id: string; lead_id: string }> = [];
  if (universeLeadIdsList.length > 0 && cadenceIds.length > 0) {
    const { data: rawMembership } = (await from(supabase, 'cadence_enrollments')
      .select('cadence_id, lead_id')
      .in('cadence_id', cadenceIds)
      .in('lead_id', universeLeadIdsList)
      .limit(20000)) as { data: Array<{ cadence_id: string; lead_id: string }> | null };
    memberships = rawMembership ?? [];
  }

  const funnel = calculateFunnel(leads, interactions);
  const stageConversions = calculateStageConversions(funnel);
  const velocity = calculateVelocity(enrollments, leads);
  const cadenceConversion = calculateCadenceConversion(cadences, memberships, interactions, leads);
  const conversionByOrigin = calculateConversionByOrigin(leads);

  return { funnel, stageConversions, velocity, cadenceConversion, conversionByOrigin };
}

function calculateFunnel(leads: LeadQueryRow[], interactions: InteractionQueryRow[]): FunnelStage[] {
  // `leads` already holds the activity universe (created-in-period ∪ touched-in-period).
  const totalLeads = leads.length;
  const leadById = new Map(leads.map((l) => [l.id, l]));

  // Contactados ⊆ universe. Sub-stages are strict subsets of Contactados so the
  // funnel is monotonic: a lead cannot be "Reunião"/"Qualificados" in this
  // period without an outbound touch in this period.
  const contactedSet = new Set(
    interactions.filter((i) => i.type === 'sent').map((i) => i.lead_id),
  );
  const meetingSet = new Set(
    interactions
      .filter((i) => i.type === 'meeting_scheduled' && contactedSet.has(i.lead_id))
      .map((i) => i.lead_id),
  );
  const qualifiedSet = new Set<string>();
  const salSet = new Set<string>();
  for (const id of contactedSet) {
    const lead = leadById.get(id);
    if (!lead) continue;
    if (lead.status === 'qualified' || lead.status === 'won') qualifiedSet.add(id);
    if (lead.status === 'won') salSet.add(id);
  }

  return [
    { label: 'Total Leads', count: totalLeads, percentage: 100, color: CONVERSION_COLORS.totalLeads },
    { label: 'Contactados', count: contactedSet.size, percentage: safeRate(contactedSet.size, totalLeads), color: CONVERSION_COLORS.contacted },
    { label: 'Qualificados', count: qualifiedSet.size, percentage: safeRate(qualifiedSet.size, totalLeads), color: CONVERSION_COLORS.qualified },
    { label: 'Reunião', count: meetingSet.size, percentage: safeRate(meetingSet.size, totalLeads), color: CONVERSION_COLORS.meeting },
    { label: 'SAL', count: salSet.size, percentage: safeRate(salSet.size, totalLeads), color: CONVERSION_COLORS.sal },
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
    leads.filter((l) => l.status === 'qualified' || l.status === 'won').map((l) => l.id),
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
  memberships: Array<{ cadence_id: string; lead_id: string }>,
  interactions: InteractionQueryRow[],
  leads: LeadQueryRow[],
): CadenceConversionRow[] {
  // All counts are attributed by universe ∩ cadence membership (at any time),
  // so a lead enrolled before the period that became qualified/won during it
  // is still credited to the right cadence. Cumulative buckets keep the
  // invariant Inscritos ≥ Em Contato ≥ Qualificado ≥ Ganho.
  const contactedLeadIds = new Set(
    leads.filter((l) => ['contacted', 'qualified', 'won'].includes(l.status)).map((l) => l.id),
  );
  const qualifiedLeadIds = new Set(
    leads.filter((l) => ['qualified', 'won'].includes(l.status)).map((l) => l.id),
  );
  const wonLeadIds = new Set(
    leads.filter((l) => l.status === 'won').map((l) => l.id),
  );

  const meetingLeadIds = new Set(
    interactions.filter((i) => i.type === 'meeting_scheduled').map((i) => i.lead_id),
  );
  const repliedLeadIds = new Set(
    interactions.filter((i) => i.type === 'replied').map((i) => i.lead_id),
  );

  const membershipsByCadence = groupBy(memberships, (m) => m.cadence_id);

  return cadences
    .map((cadence) => {
      const cadenceMembers = membershipsByCadence.get(cadence.id) ?? [];
      const cadenceLeadIds = new Set(cadenceMembers.map((m) => m.lead_id));

      const inscritos = cadenceLeadIds.size;
      const contacted = [...cadenceLeadIds].filter((id) => contactedLeadIds.has(id)).length;
      const qualified = [...cadenceLeadIds].filter((id) => qualifiedLeadIds.has(id)).length;
      const won = [...cadenceLeadIds].filter((id) => wonLeadIds.has(id)).length;
      const replies = [...cadenceLeadIds].filter((id) => repliedLeadIds.has(id)).length;
      const meetings = [...cadenceLeadIds].filter((id) => meetingLeadIds.has(id)).length;

      return {
        cadenceId: cadence.id,
        cadenceName: cadence.name,
        enrollments: inscritos,
        contacted,
        qualified,
        won,
        replies,
        meetings,
        conversionRate: safeRate(won, inscritos),
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
    if (lead.status === 'qualified' || lead.status === 'won') entry.qualified++;
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
