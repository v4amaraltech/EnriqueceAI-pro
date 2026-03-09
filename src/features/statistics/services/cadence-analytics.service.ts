import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type {
  CadenceAnalyticsData,
  CadencePerformanceRow,
  EnrollmentsByStatusEntry,
  StepProgressionEntry,
} from '../types/cadence-analytics.types';
import { safeRate } from '../types/shared';

interface CadenceRow {
  id: string;
  name: string;
  status: string;
  priority: string | null;
}

interface EnrollmentRow {
  cadence_id: string;
  lead_id: string;
  current_step: number | null;
  status: string;
  enrolled_by: string | null;
}

interface InteractionRow {
  type: string;
  cadence_id: string | null;
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

  if (cadenceId) {
    cadenceQuery = cadenceQuery.eq('id', cadenceId);
  }

  const { data: rawCadences } = (await cadenceQuery) as { data: CadenceRow[] | null };
  const cadences = rawCadences ?? [];

  if (cadences.length === 0) {
    return emptyData();
  }

  const cadenceIds = cadences.map((c) => c.id);

  // Fetch enrollments in period
  let enrQuery = from(supabase, 'cadence_enrollments')
    .select('cadence_id, lead_id, current_step, status, enrolled_by')
    .eq('org_id', orgId)
    .in('cadence_id', cadenceIds)
    .gte('enrolled_at', periodStart)
    .lte('enrolled_at', periodEnd);

  if (userIds && userIds.length > 0) {
    enrQuery = enrQuery.in('enrolled_by', userIds);
  }

  const { data: rawEnrollments } = (await enrQuery) as { data: EnrollmentRow[] | null };
  const enrollments = rawEnrollments ?? [];

  // Fetch interactions for reply/meeting counts
  let intQuery = from(supabase, 'interactions')
    .select('type, cadence_id')
    .eq('org_id', orgId)
    .in('cadence_id', cadenceIds)
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)
    .in('type', ['replied', 'meeting_scheduled']);

  const { data: rawInteractions } = (await intQuery) as { data: InteractionRow[] | null };
  const interactions = rawInteractions ?? [];

  // Fetch cadence steps for progression
  const { data: rawSteps } = (await from(supabase, 'cadence_steps')
    .select('cadence_id, step_order, channel')
    .in('cadence_id', cadenceIds)
    .order('step_order', { ascending: true })) as { data: StepRow[] | null };
  const steps = rawSteps ?? [];

  const activeCadences = cadences.filter((c) => c.status === 'active').length;
  const totalEnrolled = enrollments.length;
  const totalCompleted = enrollments.filter((e) => e.status === 'completed').length;
  const totalReplied = enrollments.filter((e) => e.status === 'replied').length;

  return {
    activeCadences,
    totalEnrolled,
    completionRate: safeRate(totalCompleted, totalEnrolled),
    replyRate: safeRate(totalReplied, totalEnrolled),
    cadenceTable: buildCadenceTable(cadences, enrollments, interactions),
    enrollmentsByStatus: buildEnrollmentsByStatus(cadences, enrollments),
    stepProgression: buildStepProgression(steps, enrollments),
  };
}

function buildCadenceTable(
  cadences: CadenceRow[],
  enrollments: EnrollmentRow[],
  interactions: InteractionRow[],
): CadencePerformanceRow[] {
  return cadences
    .map((cadence) => {
      const cadEnr = enrollments.filter((e) => e.cadence_id === cadence.id);
      const cadInt = interactions.filter((i) => i.cadence_id === cadence.id);
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
  enrollments: EnrollmentRow[],
): EnrollmentsByStatusEntry[] {
  return cadences
    .map((cadence) => {
      const cadEnr = enrollments.filter((e) => e.cadence_id === cadence.id);
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
  enrollments: EnrollmentRow[],
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

  // Count enrollments at each step
  for (const enrollment of enrollments) {
    const currentStep = enrollment.current_step ?? 1;
    for (const [stepOrder, entry] of stepMap) {
      if (currentStep >= stepOrder) {
        entry.count++;
      }
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

function emptyData(): CadenceAnalyticsData {
  return {
    activeCadences: 0,
    totalEnrolled: 0,
    completionRate: 0,
    replyRate: 0,
    cadenceTable: [],
    enrollmentsByStatus: [],
    stepProgression: [],
  };
}
