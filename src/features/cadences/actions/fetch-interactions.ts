'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { TimelineEntry, CadenceMetrics } from '../cadences.contract';
import type { CadenceEnrollmentRow, InteractionRow } from '../types';

export async function fetchLeadTimeline(
  leadId: string,
  limit = 20,
): Promise<ActionResult<TimelineEntry[]>> {
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

  const { data: interactions, error } = (await (supabase
    .from('interactions') as ReturnType<typeof supabase.from>)
    .select('*')
    .eq('lead_id', leadId)
    .eq('org_id', member.org_id)
    .order('created_at', { ascending: false })
    .limit(limit)) as { data: InteractionRow[] | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao buscar interações' };
  }

  const cadenceIds = [...new Set(
    (interactions ?? []).map((i) => i.cadence_id).filter((id): id is string => id != null),
  )];

  let cadenceMap: Record<string, string> = {};
  if (cadenceIds.length > 0) {
    const { data: cadences } = (await (supabase
      .from('cadences') as ReturnType<typeof supabase.from>)
      .select('id, name')
      .in('id', cadenceIds)) as { data: { id: string; name: string }[] | null };
    for (const c of cadences ?? []) {
      cadenceMap[c.id] = c.name;
    }
  }

  const stepIds = [...new Set(
    (interactions ?? []).map((i) => i.step_id).filter((id): id is string => id != null),
  )];

  let stepMap: Record<string, { step_order: number; activity_name: string | null; instructions: string | null }> = {};
  if (stepIds.length > 0) {
    const { data: steps } = (await (supabase
      .from('cadence_steps') as ReturnType<typeof supabase.from>)
      .select('id, step_order, activity_name, instructions')
      .in('id', stepIds)) as { data: { id: string; step_order: number; activity_name: string | null; instructions: string | null }[] | null };
    for (const s of steps ?? []) {
      stepMap[s.id] = { step_order: s.step_order, activity_name: s.activity_name, instructions: s.instructions };
    }
  }

  const timeline: TimelineEntry[] = (interactions ?? []).map((i) => {
    const meta = i.metadata as Record<string, unknown> | null;
    const stepData = i.step_id ? stepMap[i.step_id] : undefined;
    return {
      id: i.id,
      type: i.type,
      channel: i.channel,
      message_content: i.message_content,
      subject: (meta?.subject as string) ?? null,
      html_body: (meta?.html_body as string) ?? null,
      ai_generated: i.ai_generated,
      is_note: (meta?.is_note as boolean) ?? false,
      created_at: i.created_at,
      cadence_name: i.cadence_id ? cadenceMap[i.cadence_id] : undefined,
      step_order: stepData?.step_order,
      step_activity_name: stepData?.activity_name ?? undefined,
      step_instructions: stepData?.instructions ?? undefined,
    };
  });

  return { success: true, data: timeline };
}

export async function fetchCadenceMetrics(
  cadenceId: string,
): Promise<ActionResult<CadenceMetrics>> {
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

  const { data: enrollments } = (await (supabase
    .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .select('status')
    .eq('cadence_id', cadenceId)) as { data: Pick<CadenceEnrollmentRow, 'status'>[] | null };

  const all = enrollments ?? [];

  return {
    success: true,
    data: {
      total_enrolled: all.length,
      in_progress: all.filter((e) => e.status === 'active' || e.status === 'paused').length,
      completed: all.filter((e) => e.status === 'completed').length,
      replied: all.filter((e) => e.status === 'replied').length,
      bounced: all.filter((e) => e.status === 'bounced').length,
    },
  };
}
