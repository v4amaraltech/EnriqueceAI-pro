'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

import type { LeadRow } from '../types';

export async function fetchLead(
  leadId: string,
): Promise<ActionResult<LeadRow>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  // Get user's org
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data: lead, error } = (await from(supabase, 'leads')
    .select('*')
    .eq('id', leadId)
    .eq('org_id', member.org_id)
    .is('deleted_at', null)
    .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (error || !lead) {
    return { success: false, error: 'Lead não encontrado' };
  }

  return {
    success: true,
    data: lead as unknown as LeadRow,
  };
}
