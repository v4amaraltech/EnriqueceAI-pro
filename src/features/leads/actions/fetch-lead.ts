'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { LeadRow } from '../types';

export async function fetchLead(
  leadId: string,
): Promise<ActionResult<LeadRow>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: lead, error } = (await from(supabase, 'leads')
    .select('*')
    .eq('id', leadId)
    .eq('org_id', orgId)
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
