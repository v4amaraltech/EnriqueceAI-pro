'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { logLeadEventBulk } from './log-lead-event';

export async function bulkAssignLeads(
  leadIds: string[],
  userId: string,
): Promise<ActionResult<{ count: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }
  if (leadIds.length > MAX_BULK_LEAD_IDS) {
    return { success: false, error: `Máximo de ${MAX_BULK_LEAD_IDS} leads por operação` };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Validate target user is active member of org
  const { data: member } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { user_id: string } | null };

  if (!member) {
    return { success: false, error: 'Usuário não é membro ativo da organização' };
  }

  const { error } = await from(supabase, 'leads')
    .update({ assigned_to: userId } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (error) {
    return { success: false, error: 'Erro ao reatribuir leads' };
  }

  // Re-attribute downstream records so reports (team/cadence/loss-reason
  // analytics group enrollments by enrolled_by) credit the new SDR for ongoing
  // work, and so scheduled-activity ownership matches the lead's actual SDR.
  // Use service role: cadence_enrollments has no org_id column for the manager
  // path to satisfy via RLS, and scheduled_activities update needs to bypass
  // the SDR-only policy when invoked by a manager.
  const svc = createServiceRoleClient();
  await from(svc, 'cadence_enrollments')
    .update({ enrolled_by: userId } as Record<string, unknown>)
    .in('lead_id', leadIds)
    .in('status', ['active', 'paused']);
  await from(svc, 'scheduled_activities' as never)
    .update({ user_id: userId } as Record<string, unknown>)
    .in('lead_id', leadIds)
    .eq('status', 'pending');

  // Fetch assigned user name for log message
  let assigneeName = 'Usuário';
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    if (data?.user) {
      const meta = data.user.user_metadata as Record<string, string> | undefined;
      assigneeName = meta?.full_name ?? meta?.name ?? data.user.email?.split('@')[0] ?? 'Usuário';
    }
  } catch { /* fallback to default */ }

  logLeadEventBulk(supabase, {
    orgId,
    leadIds,
    userId: auth.data.userId,
    event: 'assigned',
    message: `Responsável alterado para: ${assigneeName}`,
    metadata: { assigned_to: userId },
  });

  revalidatePath('/leads');

  return { success: true, data: { count: leadIds.length } };
}
