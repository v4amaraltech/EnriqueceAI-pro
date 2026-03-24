'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export interface OrgMemberOption {
  userId: string;
  email: string;
  name: string;
}

export async function fetchOrgMembersAuth(): Promise<ActionResult<OrgMemberOption[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: members } = (await supabase
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: Array<{ user_id: string }> | null };

  if (!members || members.length === 0) {
    return { success: true, data: [] };
  }

  // Get emails and names via admin client (same pattern as get-daily-goals.ts)
  const emailMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  try {
    const adminClient = createAdminSupabaseClient();
    const memberIds = new Set(members.map((m) => m.user_id));
    const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
    if (usersData?.users) {
      for (const u of usersData.users) {
        if (memberIds.has(u.id)) {
          emailMap.set(u.id, u.email ?? u.id.slice(0, 8));
          const meta = u.user_metadata as { full_name?: string; name?: string } | undefined;
          const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
          if (fullName) nameMap.set(u.id, fullName);
        }
      }
    }
  } catch {
    // Fallback: if service_role key is missing, truncated user_id used below
  }

  const result: OrgMemberOption[] = members.map((m) => {
    const email = emailMap.get(m.user_id) ?? m.user_id.slice(0, 8);
    return {
      userId: m.user_id,
      email,
      name: nameMap.get(m.user_id) ?? email,
    };
  });

  return { success: true, data: result };
}
