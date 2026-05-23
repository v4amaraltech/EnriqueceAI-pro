'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';

import { logLeadEventBulk } from './log-lead-event';

type ReopenableLead = {
  id: string;
  status: string;
  contacted_at: string | null;
  qualified_at: string | null;
  meeting_scheduled_at: string | null;
};

function pickReopenStatus(lead: ReopenableLead): 'qualified' | 'contacted' | 'new' {
  if (lead.qualified_at || lead.meeting_scheduled_at) return 'qualified';
  if (lead.contacted_at) return 'contacted';
  return 'new';
}

export async function bulkReopenLeads(
  leadIds: string[],
): Promise<ActionResult<{ count: number; skipped: number }>> {
  if (leadIds.length === 0) {
    return { success: false, error: 'Nenhum lead selecionado' };
  }
  if (leadIds.length > MAX_BULK_LEAD_IDS) {
    return { success: false, error: `Máximo de ${MAX_BULK_LEAD_IDS} leads por operação` };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase, userId } = auth.data;

  const { data: rows, error: fetchError } = (await from(supabase, 'leads')
    .select('id, status, contacted_at, qualified_at, meeting_scheduled_at')
    .eq('org_id', orgId)
    .eq('status', 'unqualified')
    .in('id', leadIds)) as { data: ReopenableLead[] | null; error: unknown };

  if (fetchError) {
    return { success: false, error: 'Erro ao buscar leads para reabrir' };
  }

  const eligible = rows ?? [];
  if (eligible.length === 0) {
    return { success: false, error: 'Nenhum dos leads selecionados está perdido' };
  }

  const groups = new Map<'qualified' | 'contacted' | 'new', string[]>();
  for (const lead of eligible) {
    const next = pickReopenStatus(lead);
    const bucket = groups.get(next) ?? [];
    bucket.push(lead.id);
    groups.set(next, bucket);
  }

  for (const [nextStatus, ids] of groups) {
    const { error } = await from(supabase, 'leads')
      .update({ status: nextStatus } as Record<string, unknown>)
      .eq('org_id', orgId)
      .in('id', ids);
    if (error) {
      return { success: false, error: 'Erro ao reabrir leads' };
    }
  }

  const allIds = eligible.map((l) => l.id);
  logLeadEventBulk(supabase, {
    orgId,
    leadIds: allIds,
    userId,
    event: 'lead_reopened',
    message: 'Lead reaberto (em massa)',
    metadata: { from_status: 'unqualified' },
  });

  revalidatePath('/leads');

  return {
    success: true,
    data: { count: eligible.length, skipped: leadIds.length - eligible.length },
  };
}
