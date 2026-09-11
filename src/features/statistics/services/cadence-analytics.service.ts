import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';

import type {
  CadenceAnalyticsData,
  CadenceConversionRow,
  CadenceDistributionRow,
  CadencePerformanceRow,
  EnrollmentsByStatusEntry,
  StepProgressionEntry,
} from '../types/cadence-analytics.types';
import type { EnrollmentQueryRow, InteractionQueryRow } from '../types/query-rows';
import { groupBy, safeRate } from '../types/shared';
import { readAllRows } from './read-all-rows';

interface CadenceRow {
  id: string;
  name: string;
  status: string;
  priority: string | null;
}

interface StepRow {
  cadence_id: string;
  step_order: number;
  channel: string;
}

export async function fetchCadenceAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
): Promise<CadenceAnalyticsData> {
  // Fetch cadences (non-deleted)
  let cadenceQuery = from(supabase, 'cadences')
    .select('id, name, status, priority')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (isUuid(cadenceId)) {
    cadenceQuery = cadenceQuery.eq('id', cadenceId);
  }

  const { data: rawCadences } = (await cadenceQuery) as { data: CadenceRow[] | null };
  const cadences = rawCadences ?? [];

  if (cadences.length === 0) {
    return emptyData();
  }

  const cadenceIds = cadences.map((c) => c.id);

  // Fetch all enrollments for these cadences (org isolation via cadenceIds which are already org-filtered)
  // Todas as consultas abaixo são paginadas (antes `.limit(10000)`, que cortava
  // em silêncio: ~13 mil interações de engajamento em 30 dias na V4 Amaral e os
  // enrollments, sem período, só crescem — set/2026).
  const enrollments = await readAllRows<EnrollmentQueryRow>('cadências: enrollments', () => {
    let q = from(supabase, 'cadence_enrollments')
      .select('cadence_id, lead_id, current_step, status, enrolled_by')
      .in('cadence_id', cadenceIds);
    if (userIds && userIds.length > 0) q = q.in('enrolled_by', userIds);
    return q.order('id', { ascending: true });
  });

  // Fetch interactions for reply/meeting counts
  const interactions = await readAllRows<InteractionQueryRow>('cadências: respostas/reuniões', () =>
    from(supabase, 'interactions')
      .select('type, cadence_id')
      .eq('org_id', orgId)
      .in('cadence_id', cadenceIds)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)
      .in('type', ['replied', 'meeting_scheduled'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  );

  // Fetch cadence steps for progression
  const { data: rawSteps } = (await from(supabase, 'cadence_steps')
    .select('cadence_id, step_order, channel')
    .in('cadence_id', cadenceIds)
    .order('step_order', { ascending: true })) as { data: StepRow[] | null };
  const steps = rawSteps ?? [];

  // Fetch engagement interactions (sent + opened + clicked + replied + meeting_scheduled) with lead_id
  const engagementInteractions = await readAllRows<InteractionQueryRow>('cadências: engajamento', () =>
    from(supabase, 'interactions')
      .select('type, lead_id')
      .eq('org_id', orgId)
      .in('cadence_id', cadenceIds)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)
      .in('type', ['sent', 'opened', 'clicked', 'replied', 'meeting_scheduled'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  );

  const activeCadences = cadences.filter((c) => c.status === 'active').length;
  const totalEnrolled = enrollments.length;
  const totalCompleted = enrollments.filter((e) => e.status === 'completed').length;
  // Replies count distinct leads from interactions, not enrollment status:
  // status='replied' only sticks while the enrollment is 'active', so replies
  // landing after the sequence ends are missed (same fix as the cadence table).
  // engagementInteractions already carries 'replied' rows with lead_id.
  const totalReplied = new Set(
    engagementInteractions.filter((i) => i.type === 'replied').map((i) => i.lead_id),
  ).size;

  // Engagement KPIs
  const sentLeadIds = new Set(
    engagementInteractions.filter((i) => i.type === 'sent').map((i) => i.lead_id),
  );
  const engagedLeadIds = new Set(
    engagementInteractions
      .filter((i) => ['opened', 'clicked', 'replied', 'meeting_scheduled'].includes(i.type))
      .map((i) => i.lead_id),
  );
  const totalSent = engagementInteractions.filter((i) => i.type === 'sent').length;

  // Build lookup maps once — O(n) instead of O(n²) per helper
  const enrollmentsByCadence = groupBy(enrollments, (e) => e.cadence_id);
  const interactionsByCadence = groupBy(interactions, (i) => i.cadence_id ?? '');

  return {
    activeCadences,
    totalEnrolled,
    completionRate: safeRate(totalCompleted, totalEnrolled),
    replyRate: safeRate(totalReplied, totalEnrolled),
    cadenceTable: buildCadenceTable(cadences, enrollmentsByCadence, interactionsByCadence),
    enrollmentsByStatus: buildEnrollmentsByStatus(cadences, enrollmentsByCadence),
    stepProgression: buildStepProgression(steps, enrollments),
    totalSent,
    engagedLeads: engagedLeadIds.size,
    engagementRate: safeRate(engagedLeadIds.size, sentLeadIds.size),
    conversionRows: buildConversionRows(cadences, enrollmentsByCadence),
    distributionRows: buildDistributionRows(cadences, enrollmentsByCadence),
  };
}

function buildCadenceTable(
  cadences: CadenceRow[],
  enrollmentsByCadence: Map<string, EnrollmentQueryRow[]>,
  interactionsByCadence: Map<string, InteractionQueryRow[]>,
): CadencePerformanceRow[] {
  return cadences
    .map((cadence) => {
      const cadEnr = enrollmentsByCadence.get(cadence.id) ?? [];
      const cadInt = interactionsByCadence.get(cadence.id) ?? [];
      const enrolled = cadEnr.length;
      const completed = cadEnr.filter((e) => e.status === 'completed').length;
      const replied = cadInt.filter((i) => i.type === 'replied').length;

      return {
        cadenceId: cadence.id,
        cadenceName: cadence.name,
        status: cadence.status,
        priority: cadence.priority,
        enrolled,
        completed,
        replied,
        rate: safeRate(completed + replied, enrolled),
      };
    })
    .filter((c) => c.enrolled > 0)
    .sort((a, b) => b.enrolled - a.enrolled);
}

function buildEnrollmentsByStatus(
  cadences: CadenceRow[],
  enrollmentsByCadence: Map<string, EnrollmentQueryRow[]>,
): EnrollmentsByStatusEntry[] {
  return cadences
    .map((cadence) => {
      const cadEnr = enrollmentsByCadence.get(cadence.id) ?? [];
      return {
        cadenceName: cadence.name,
        active: cadEnr.filter((e) => e.status === 'active').length,
        paused: cadEnr.filter((e) => e.status === 'paused').length,
        completed: cadEnr.filter((e) => e.status === 'completed').length,
        replied: cadEnr.filter((e) => e.status === 'replied').length,
        bounced: cadEnr.filter((e) => e.status === 'bounced').length,
        unsubscribed: cadEnr.filter((e) => e.status === 'unsubscribed').length,
      };
    })
    .filter((c) => c.active + c.paused + c.completed + c.replied + c.bounced + c.unsubscribed > 0)
    .sort((a, b) => {
      const totalB = b.active + b.paused + b.completed + b.replied + b.bounced + b.unsubscribed;
      const totalA = a.active + a.paused + a.completed + a.replied + a.bounced + a.unsubscribed;
      return totalB - totalA;
    })
    .slice(0, 10);
}

function buildStepProgression(
  steps: StepRow[],
  enrollments: EnrollmentQueryRow[],
): StepProgressionEntry[] {
  // Get unique step orders from all cadences
  const stepMap = new Map<number, { label: string; count: number }>();

  for (const step of steps) {
    if (!stepMap.has(step.step_order)) {
      stepMap.set(step.step_order, {
        label: `Etapa ${step.step_order}`,
        count: 0,
      });
    }
  }

  // Count enrollments at each step — O(E + S) instead of O(E × S)
  // First, count enrollments by their current_step
  const enrollmentStepCounts = new Map<number, number>();
  for (const enrollment of enrollments) {
    const currentStep = enrollment.current_step ?? 1;
    enrollmentStepCounts.set(currentStep, (enrollmentStepCounts.get(currentStep) ?? 0) + 1);
  }
  // Merge all step values (from stepMap and enrollments) and sort descending
  // Walking from highest to lowest, cumulative = count of enrollments at step >= current
  const allStepValues = new Set([...stepMap.keys(), ...enrollmentStepCounts.keys()]);
  const sortedDesc = Array.from(allStepValues).sort((a, b) => b - a);
  let cumulative = 0;
  for (const stepVal of sortedDesc) {
    cumulative += enrollmentStepCounts.get(stepVal) ?? 0;
    const entry = stepMap.get(stepVal);
    if (entry) {
      entry.count = cumulative;
    }
  }

  return Array.from(stepMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([stepOrder, entry]) => ({
      stepLabel: entry.label,
      stepOrder,
      count: entry.count,
    }));
}

function buildConversionRows(cadences: CadenceRow[], enrollmentsByCadence: Map<string, EnrollmentQueryRow[]>): CadenceConversionRow[] {
  return cadences.map((c) => {
    const cEnrollments = enrollmentsByCadence.get(c.id) ?? [];
    const total = cEnrollments.length;
    const completed = cEnrollments.filter((e) => e.status === 'completed' || e.status === 'replied').length;
    const lost = total - completed;
    return {
      cadenceId: c.id,
      cadenceName: c.name,
      totalLeads: total,
      won: completed,
      lost,
      wonPercent: safeRate(completed, total),
      lostPercent: safeRate(lost, total),
    };
  }).filter((r) => r.totalLeads > 0).sort((a, b) => b.totalLeads - a.totalLeads);
}

function buildDistributionRows(cadences: CadenceRow[], enrollmentsByCadence: Map<string, EnrollmentQueryRow[]>): CadenceDistributionRow[] {
  return cadences.map((c) => {
    const cEnrollments = enrollmentsByCadence.get(c.id) ?? [];
    return {
      cadenceId: c.id,
      cadenceName: c.name,
      totalLeads: cEnrollments.length,
      active: cEnrollments.filter((e) => e.status === 'active').length,
      paused: cEnrollments.filter((e) => e.status === 'paused').length,
      completed: cEnrollments.filter((e) => e.status === 'completed').length,
      replied: cEnrollments.filter((e) => e.status === 'replied').length,
      bounced: cEnrollments.filter((e) => e.status === 'bounced').length,
    };
  }).filter((r) => r.totalLeads > 0).sort((a, b) => b.totalLeads - a.totalLeads);
}

function emptyData(): CadenceAnalyticsData {
  return {
    activeCadences: 0,
    totalEnrolled: 0,
    completionRate: 0,
    replyRate: 0,
    cadenceTable: [],
    enrollmentsByStatus: [],
    stepProgression: [],
    totalSent: 0,
    engagedLeads: 0,
    engagementRate: 0,
    conversionRows: [],
    distributionRows: [],
  };
}
