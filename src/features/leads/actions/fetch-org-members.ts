'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export interface OrgMemberOption {
  userId: string;
  email: string;
  name: string;
  /** Org role — lets consumers restrict to SDRs (e.g. the per-SDR activity filter). */
  role: 'manager' | 'sdr';
}

export async function fetchOrgMembersAuth(): Promise<ActionResult<OrgMemberOption[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Get active members for this org
  const { data: rawMembers } = (await from(supabase, 'organization_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: { user_id: string; role: 'manager' | 'sdr' }[] | null };

  if (!rawMembers?.length) {
    return { success: true, data: [] };
  }

  // Resolve names via service role getUserById (listUsers fails on this project)
  const service = createServiceRoleClient();
  const result: OrgMemberOption[] = [];

  await Promise.all(
    rawMembers.map(async (m) => {
      try {
        const { data, error } = await service.auth.admin.getUserById(m.user_id);
        if (error || !data?.user) {
          console.error(`[fetch-org-members] getUserById(${m.user_id.slice(0, 8)}) failed:`, error?.message);
          result.push({ userId: m.user_id, email: m.user_id.slice(0, 8), name: m.user_id.slice(0, 8), role: m.role });
          return;
        }
        const u = data.user;
        const meta = u.user_metadata as Record<string, string> | undefined;
        const name = meta?.full_name ?? meta?.name ?? u.email?.split('@')[0] ?? m.user_id.slice(0, 8);
        result.push({ userId: m.user_id, email: u.email ?? m.user_id.slice(0, 8), name, role: m.role });
      } catch (err) {
        console.error(`[fetch-org-members] Error for ${m.user_id.slice(0, 8)}:`, err);
        result.push({ userId: m.user_id, email: m.user_id.slice(0, 8), name: m.user_id.slice(0, 8), role: m.role });
      }
    }),
  );

  // Sort by name for consistent display
  result.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return { success: true, data: result };
}
