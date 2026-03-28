'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { ChannelType } from '@/features/cadences/types';

export interface EnrollmentStepInfo {
  step_order: number;
  channel: ChannelType;
  status: 'completed' | 'current' | 'future';
}

export interface EnrollmentInfo {
  cadence_name: string;
  status: string;
  current_step: number;
  total_steps: number;
  enrolled_by_email: string | null;
  steps: EnrollmentStepInfo[];
}

export interface LeadEnrollmentData {
  /** First active enrollment (backward compat) */
  enrollment: Omit<EnrollmentInfo, 'steps'> | null;
  /** Steps of the first enrollment (backward compat) */
  steps: EnrollmentStepInfo[];
  /** All active/paused enrollments */
  enrollments: EnrollmentInfo[];
  kpis: {
    completed: number;
    open: number;
    conversations: number;
  };
}

const leadIdSchema = z.string().uuid('ID inválido');

export async function fetchLeadEnrollment(
  leadId: string,
): Promise<ActionResult<LeadEnrollmentData>> {
  const parsed = leadIdSchema.safeParse(leadId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Get all active/paused enrollments with cadence info
  const { data: enrollmentRows } = await from(supabase, 'cadence_enrollments')
    .select(`
      id,
      cadence_id,
      status,
      current_step,
      enrolled_by,
      cadences!inner ( name, total_steps )
    `)
    .eq('lead_id', leadId)
    .in('status', ['active', 'paused']);

  type EnrollmentRow = {
    id: string;
    cadence_id: string;
    status: string;
    current_step: number;
    enrolled_by: string | null;
    cadences: { name: string; total_steps: number };
  };

  const rows = (enrollmentRows ?? []) as unknown as EnrollmentRow[];

  // Collect unique enrolled_by user IDs
  const enrolledByIds = [...new Set(rows.map((r) => r.enrolled_by).filter(Boolean))] as string[];
  const emailMap = new Map<string, string>();
  if (enrolledByIds.length > 0) {
    const { data: members } = (await from(supabase, 'organization_members')
      .select('user_id, user_email')
      .in('user_id', enrolledByIds)) as { data: Array<{ user_id: string; user_email: string | null }> | null };
    for (const m of members ?? []) {
      if (m.user_email) emailMap.set(m.user_id, m.user_email);
    }
  }

  // Fetch steps for all cadences in parallel
  const cadenceIds = [...new Set(rows.map((r) => r.cadence_id))];
  const stepsMap = new Map<string, Array<{ step_order: number; channel: string }>>();
  if (cadenceIds.length > 0) {
    const { data: allSteps } = await from(supabase, 'cadence_steps')
      .select('cadence_id, step_order, channel')
      .in('cadence_id', cadenceIds)
      .order('step_order', { ascending: true });
    for (const s of (allSteps ?? []) as Array<{ cadence_id: string; step_order: number; channel: string }>) {
      const existing = stepsMap.get(s.cadence_id) ?? [];
      existing.push(s);
      stepsMap.set(s.cadence_id, existing);
    }
  }

  // Build enrollments array
  const enrollments: EnrollmentInfo[] = rows.map((row) => {
    const rawSteps = stepsMap.get(row.cadence_id) ?? [];
    return {
      cadence_name: row.cadences.name,
      status: row.status,
      current_step: row.current_step,
      total_steps: row.cadences.total_steps,
      enrolled_by_email: row.enrolled_by ? (emailMap.get(row.enrolled_by) ?? null) : null,
      steps: rawSteps.map((s) => ({
        step_order: s.step_order,
        channel: s.channel as ChannelType,
        status: s.step_order < row.current_step
          ? 'completed' as const
          : s.step_order === row.current_step
            ? 'current' as const
            : 'future' as const,
      })),
    };
  });

  const firstEnrollment = enrollments[0] ?? null;

  // KPIs from interactions
  const [completedRes, openRes, conversationRes] = await Promise.all([
    from(supabase, 'interactions')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .in('type', ['sent', 'delivered', 'opened', 'clicked']),
    from(supabase, 'interactions')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .eq('type', 'sent'),
    from(supabase, 'interactions')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .in('type', ['replied', 'meeting_scheduled']),
  ]);

  return {
    success: true,
    data: {
      enrollment: firstEnrollment ? {
        cadence_name: firstEnrollment.cadence_name,
        status: firstEnrollment.status,
        current_step: firstEnrollment.current_step,
        total_steps: firstEnrollment.total_steps,
        enrolled_by_email: firstEnrollment.enrolled_by_email,
      } : null,
      steps: firstEnrollment?.steps ?? [],
      enrollments,
      kpis: {
        completed: completedRes.count ?? 0,
        open: openRes.count ?? 0,
        conversations: conversationRes.count ?? 0,
      },
    },
  };
}
