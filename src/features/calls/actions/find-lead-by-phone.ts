'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';
import { normalizePhone } from '@/lib/utils/phone';

interface LeadPhoneMatch {
  leadId: string;
  enrollmentId: string | null;
  cadenceId: string | null;
  stepId: string | null;
}

/**
 * Find a lead by phone number, checking both leads.telefone and socios->celulares.
 * If found, also looks for an active cadence enrollment to enable cadence advancement.
 */
export async function findLeadByPhone(
  phone: string,
): Promise<ActionResult<LeadPhoneMatch | null>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 8) {
    return { success: true, data: null };
  }

  // Try exact match on leads.telefone first (most common)
  const { data: directMatch } = (await from(supabase, 'leads')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .or(`telefone.like.%${sanitizeFilterValue(normalized)}%`)
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  let leadId: string | null = directMatch?.id ?? null;

  // If no direct match, search in socios JSONB celulares using text cast
  // socios is JSONB array with celulares sub-array containing {ddd, numero, ...}
  if (!leadId) {
    const phoneSuffix = normalized.slice(-8);
    const { data: socioMatch } = (await from(supabase, 'leads')
      .select('id')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .like('socios::text' as never, `%${phoneSuffix}%` as never)
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };

    leadId = socioMatch?.id ?? null;
  }

  if (!leadId) {
    return { success: true, data: null };
  }

  // Look for active enrollment for this lead
  const { data: enrollment } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, current_step')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: { id: string; cadence_id: string; current_step: number } | null;
  };

  let stepId: string | null = null;
  if (enrollment) {
    // Get the current step's ID
    const { data: step } = (await from(supabase, 'cadence_steps')
      .select('id')
      .eq('cadence_id', enrollment.cadence_id)
      .eq('step_order', enrollment.current_step)
      .maybeSingle()) as { data: { id: string } | null };

    stepId = step?.id ?? null;
  }

  return {
    success: true,
    data: {
      leadId,
      enrollmentId: enrollment?.id ?? null,
      cadenceId: enrollment?.cadence_id ?? null,
      stepId,
    },
  };
}
