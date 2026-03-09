'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

const CHUNK_SIZE = 100;

/**
 * Batch recalculate engagement_score for ALL leads in an org.
 * Calls the PostgreSQL recalc_engagement_score() function per lead.
 * Requires manager auth — orgId is derived from the authenticated user.
 */
export async function recalcEngagementScoresForOrg(): Promise<ActionResult<{ updated: number }>> {
  const { orgId, supabase } = await getManagerOrgId();

  // Fetch lead IDs
  const { data: leads, error } = (await from(supabase, 'leads')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)) as {
    data: Array<{ id: string }> | null;
    error: unknown;
  };

  if (error || !leads) {
    return { success: false, error: 'Erro ao buscar leads para recalculo' };
  }

  // Process in chunks, calling the DB function for each lead
  let updated = 0;
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE);
    for (const lead of chunk) {
      await (supabase.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<unknown>)(
        'recalc_engagement_score',
        { p_lead_id: lead.id },
      );
      updated++;
    }
  }

  return { success: true, data: { updated } };
}
