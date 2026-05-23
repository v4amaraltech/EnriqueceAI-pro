'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface CadenceProgramStep {
  stepId: string;
  stepOrder: number;
  channel: string;
  activityName: string | null;
  delayDays: number;
  delayHours: number;
  /** Cumulative days from enrollment start (e.g. "D+0", "D+2", "D+5"). */
  dayLabel: string;
  /** executed | current | scheduled */
  status: 'executed' | 'current' | 'scheduled';
  /** ISO date — when the step happened (executed) or is expected (current/scheduled). */
  date: string | null;
}

export interface CadenceProgram {
  enrollmentId: string;
  cadenceId: string;
  cadenceName: string;
  enrollmentStatus: string;
  enrolledAt: string;
  steps: CadenceProgramStep[];
}

/**
 * Builds the cadence program view for a lead: every step in the cadence labeled
 * with its cumulative day (D+0, D+2, D+5...) and tagged executed / current /
 * scheduled. Mirrors Meetime's "lead detail" cadence panel so SDRs see the full
 * recipe even though the daily queue only surfaces the next 24h.
 *
 * Returns ALL active/paused enrollments for the lead — usually one, but the
 * schema allows multiple cadences enrolling the same lead.
 */
export async function fetchCadencePrograms(leadId: string): Promise<ActionResult<CadenceProgram[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, current_step, status, next_step_due, enrolled_at')
    .eq('lead_id', leadId)
    .eq('org_id', orgId)
    .in('status', ['active', 'paused', 'completed', 'replied'])
    .order('enrolled_at', { ascending: false })) as {
    data: Array<{
      id: string;
      cadence_id: string;
      current_step: number;
      status: string;
      next_step_due: string | null;
      enrolled_at: string;
    }> | null;
  };

  if (!enrollments?.length) return { success: true, data: [] };

  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];

  const [cadencesResult, stepsResult, interactionsResult] = await Promise.all([
    from(supabase, 'cadences')
      .select('id, name')
      .in('id', cadenceIds) as Promise<{ data: Array<{ id: string; name: string }> | null }>,
    from(supabase, 'cadence_steps')
      .select('id, cadence_id, step_order, channel, activity_name, delay_days, delay_hours')
      .in('cadence_id', cadenceIds)
      .order('step_order', { ascending: true }) as Promise<{
        data: Array<{
          id: string;
          cadence_id: string;
          step_order: number;
          channel: string;
          activity_name: string | null;
          delay_days: number;
          delay_hours: number;
        }> | null;
      }>,
    from(supabase, 'interactions')
      .select('step_id, cadence_id, created_at')
      .eq('lead_id', leadId)
      .eq('org_id', orgId)
      .in('cadence_id', cadenceIds)
      .in('type', ['sent', 'delivered'])
      .order('created_at', { ascending: true }) as Promise<{
        data: Array<{ step_id: string | null; cadence_id: string | null; created_at: string }> | null;
      }>,
  ]);

  const cadenceMap = new Map((cadencesResult.data ?? []).map((c) => [c.id, c.name]));
  const stepsByCadence = new Map<string, typeof stepsResult.data extends (infer T)[] | null ? T : never>();
  for (const s of stepsResult.data ?? []) {
    const list = (stepsByCadence.get(s.cadence_id) as unknown as typeof stepsResult.data) ?? [];
    (list as Array<typeof s>).push(s);
    stepsByCadence.set(s.cadence_id, list as never);
  }
  const interactionByStep = new Map<string, string>(); // stepId -> earliest created_at
  for (const i of interactionsResult.data ?? []) {
    if (!i.step_id) continue;
    const existing = interactionByStep.get(i.step_id);
    if (!existing || i.created_at < existing) interactionByStep.set(i.step_id, i.created_at);
  }

  const programs: CadenceProgram[] = enrollments.map((enrollment) => {
    const steps = ((stepsByCadence.get(enrollment.cadence_id) ?? []) as unknown as Array<{
      id: string;
      step_order: number;
      channel: string;
      activity_name: string | null;
      delay_days: number;
      delay_hours: number;
    }>).slice().sort((a, b) => a.step_order - b.step_order);

    // Cumulative day label per step (sum of delay_days from previous steps).
    let cumulativeDays = 0;
    const enrolledAtMs = new Date(enrollment.enrolled_at).getTime();
    const nextDueMs = enrollment.next_step_due ? new Date(enrollment.next_step_due).getTime() : null;

    const programSteps: CadenceProgramStep[] = steps.map((step, idx) => {
      if (idx > 0) cumulativeDays += step.delay_days;

      let status: 'executed' | 'current' | 'scheduled';
      if (step.step_order < enrollment.current_step) status = 'executed';
      else if (step.step_order === enrollment.current_step && enrollment.status === 'active') status = 'current';
      else if (step.step_order === enrollment.current_step) status = 'scheduled';
      else status = 'scheduled';

      // Date resolution:
      //  - executed: pull from interactions.created_at if available
      //  - current: next_step_due of enrollment
      //  - scheduled: extrapolate from current's next_step_due using accumulated delays
      let date: string | null = null;
      if (status === 'executed') {
        date = interactionByStep.get(step.id) ?? null;
        // Fallback: project from enrolled_at using the step's cumulative days
        if (!date) {
          date = new Date(enrolledAtMs + cumulativeDays * 86400000).toISOString();
        }
      } else if (status === 'current') {
        date = enrollment.next_step_due;
      } else if (nextDueMs) {
        // Sum delays from current_step+1 up to this step
        const currentIdx = steps.findIndex((s) => s.step_order === enrollment.current_step);
        if (currentIdx >= 0) {
          let extraDays = 0;
          let extraHours = 0;
          for (let i = currentIdx + 1; i <= idx; i++) {
            const s = steps[i];
            if (!s) continue;
            extraDays += s.delay_days;
            extraHours += s.delay_hours;
          }
          date = new Date(nextDueMs + extraDays * 86400000 + extraHours * 3600000).toISOString();
        }
      }

      return {
        stepId: step.id,
        stepOrder: step.step_order,
        channel: step.channel,
        activityName: step.activity_name,
        delayDays: step.delay_days,
        delayHours: step.delay_hours,
        dayLabel: `D+${cumulativeDays}`,
        status,
        date,
      };
    });

    return {
      enrollmentId: enrollment.id,
      cadenceId: enrollment.cadence_id,
      cadenceName: cadenceMap.get(enrollment.cadence_id) ?? 'Cadência',
      enrollmentStatus: enrollment.status,
      enrolledAt: enrollment.enrolled_at,
      steps: programSteps,
    };
  });

  return { success: true, data: programs };
}
