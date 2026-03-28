'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { buildMemberInfoMap } from '@/features/statistics/services/member-lookup';

export interface OrgMemberOption {
  userId: string;
  email: string;
  name: string;
}

export async function fetchOrgMembersAuth(): Promise<ActionResult<OrgMemberOption[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const infoMap = await buildMemberInfoMap(supabase, orgId);

  const result: OrgMemberOption[] = Array.from(infoMap.entries()).map(([userId, info]) => ({
    userId,
    email: info.email,
    name: info.name,
  }));

  return { success: true, data: result };
}
