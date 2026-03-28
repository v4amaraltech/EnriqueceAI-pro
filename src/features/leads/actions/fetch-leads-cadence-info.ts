'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { LeadCadenceInfo } from '../types';

export async function fetchLeadsCadenceInfo(
  leadIds: string[],
): Promise<ActionResult<Record<string, LeadCadenceInfo>>> {
  if (leadIds.length === 0) {
    return { success: true, data: {} };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { data, error } = await from(supabase, 'cadence_enrollments')
    .select(`
      lead_id,
      status,
      cadences!inner ( name ),
      enrolled_by
    `)
    .in('lead_id', leadIds)
    .in('status', ['active', 'paused']);

  if (error) {
    return { success: false, error: 'Erro ao buscar informações de cadência' };
  }

  const result: Record<string, LeadCadenceInfo> = {};

  if (data) {
    for (const row of data as unknown as Array<{
      lead_id: string;
      status: 'active' | 'paused';
      cadences: { name: string } | null;
      enrolled_by: string | null;
    }>) {
      // Only keep the first active enrollment per lead
      if (!result[row.lead_id]) {
        result[row.lead_id] = {
          cadence_name: row.cadences?.name ?? null,
          responsible_email: row.enrolled_by,
          enrollment_status: row.status,
        };
      }
    }
  }

  // Resolve enrolled_by user IDs to emails
  const userIds = [...new Set(Object.values(result).map((r) => r.responsible_email).filter(Boolean))] as string[];

  if (userIds.length > 0) {
    const { data: members } = await from(supabase, 'organization_members')
      .select('user_id, user_email')
      .in('user_id', userIds);

    if (members) {
      const emailMap = new Map(
        (members as unknown as Array<{ user_id: string; user_email: string | null }>).map((m) => [m.user_id, m.user_email]),
      );
      for (const info of Object.values(result)) {
        if (info.responsible_email) {
          info.responsible_email = emailMap.get(info.responsible_email) ?? info.responsible_email;
        }
      }
    }
  }

  return { success: true, data: result };
}
