'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';

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

  // Resolve names/e-mails from auth.users (one query)
  const profiles = await resolveUserProfiles(rawMembers.map((m) => m.user_id));
  const result: OrgMemberOption[] = rawMembers.map((m) => {
    const p = profiles.get(m.user_id);
    if (!p) console.error(`[fetch-org-members] no auth user for ${m.user_id.slice(0, 8)}`);
    return {
      userId: m.user_id,
      email: p?.email ?? m.user_id.slice(0, 8),
      name: p?.displayName ?? m.user_id.slice(0, 8),
      role: m.role,
    };
  });

  // Sort by name for consistent display
  result.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return { success: true, data: result };
}
