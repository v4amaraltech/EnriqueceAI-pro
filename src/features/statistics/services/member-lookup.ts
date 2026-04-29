import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

export interface MemberInfo {
  email: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Build a map of user_id → {email, name} for organization members.
 * Uses admin client to look up from auth.users since organization_members
 * does not have user_email/name columns.
 */
export async function buildMemberInfoMap(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, MemberInfo>> {
  const { data: rawMembers } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: { user_id: string }[] | null };

  if (!rawMembers?.length) return new Map();

  const memberIdSet = new Set(rawMembers.map((m) => m.user_id));

  // Use service role client to list auth users (auth.admin requires service_role key)
  try {
    const { createServiceRoleClient } = await import('@/lib/supabase/service');
    const service = createServiceRoleClient();
    const { data: usersData, error } = await service.auth.admin.listUsers({ perPage: 1000 });

    if (error) {
      console.error('[member-lookup] listUsers error:', error.message);
    }

    if (usersData?.users) {
      const result = new Map<string, MemberInfo>();
      for (const u of usersData.users) {
        if (memberIdSet.has(u.id)) {
          const meta = u.user_metadata as Record<string, string> | undefined;
          const name = meta?.full_name ?? meta?.name ?? u.email?.split('@')[0] ?? u.id.slice(0, 8);
          const avatarUrl = meta?.avatar_url;
          result.set(u.id, { email: u.email ?? u.id.slice(0, 8), name, avatarUrl });
        }
      }
      for (const m of rawMembers) {
        if (!result.has(m.user_id)) {
          result.set(m.user_id, { email: m.user_id.slice(0, 8), name: m.user_id.slice(0, 8) });
        }
      }
      return result;
    }
  } catch (err) {
    console.error('[member-lookup] Failed to resolve member names:', err);
  }

  return new Map(rawMembers.map((m) => [m.user_id, { email: m.user_id.slice(0, 8), name: m.user_id.slice(0, 8) }]));
}

/**
 * Build a map of user_id → display name for organization members.
 * Convenience wrapper around buildMemberInfoMap.
 */
export async function buildMemberNameMap(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, string>> {
  const infoMap = await buildMemberInfoMap(supabase, orgId);
  return new Map(Array.from(infoMap.entries()).map(([id, info]) => [id, info.name]));
}
