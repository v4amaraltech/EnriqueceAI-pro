'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';

import type { TimelineEntry, CadenceMetrics } from '../cadences.contract';
import type { CadenceEnrollmentRow, InteractionRow } from '../types';

export async function fetchLeadTimeline(
  leadId: string,
  limit = 20,
): Promise<ActionResult<TimelineEntry[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: interactions, error } = (await from(supabase, 'interactions')
    .select('*')
    .eq('lead_id', leadId)
    .eq('org_id', orgId)
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
    const { data: cadences } = (await from(supabase, 'cadences')
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
    const { data: steps } = (await from(supabase, 'cadence_steps')
      .select('id, step_order, activity_name, instructions')
      .in('id', stepIds)) as { data: { id: string; step_order: number; activity_name: string | null; instructions: string | null }[] | null };
    for (const s of steps ?? []) {
      stepMap[s.id] = { step_order: s.step_order, activity_name: s.activity_name, instructions: s.instructions };
    }
  }

  // Resolve user names for performed_by
  const performerIds = [...new Set(
    (interactions ?? []).map((i) => i.performed_by as string | null).filter((id): id is string => id != null),
  )];
  const userNameMap = new Map<string, string>();
  if (performerIds.length > 0) {
    try {
      const adminClient = createAdminSupabaseClient();
      const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
      for (const u of usersData?.users ?? []) {
        if (performerIds.includes(u.id)) {
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const name = (meta?.full_name ?? meta?.name ?? '') as string;
          userNameMap.set(u.id, name || u.email?.split('@')[0] || u.id.slice(0, 8));
        }
      }
    } catch {
      // Fallback silently
    }
  }

  const timeline: TimelineEntry[] = (interactions ?? []).map((i) => {
    const meta = i.metadata as Record<string, unknown> | null;
    const stepData = i.step_id ? stepMap[i.step_id] : undefined;
    const performedBy = i.performed_by as string | null;
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
      metadata: meta,
      performed_by_name: performedBy ? userNameMap.get(performedBy) : undefined,
    };
  });

  return { success: true, data: timeline };
}

export async function fetchCadenceMetrics(
  cadenceId: string,
): Promise<ActionResult<CadenceMetrics>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
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
