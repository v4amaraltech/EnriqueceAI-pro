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

  const memberIds = rawMembers.map((m) => m.user_id);

  // Query auth.users directly via service role (more reliable than admin.listUsers API)
  try {
    const { createServiceRoleClient } = await import('@/lib/supabase/service');
    const service = createServiceRoleClient();
    const { data: authUsers } = (await service
      .from('users' as never)
      .select('id, email, raw_user_meta_data')
      .in('id', memberIds)) as { data: Array<{ id: string; email: string | null; raw_user_meta_data: Record<string, string> | null }> | null };

    if (authUsers?.length) {
      const result = new Map<string, MemberInfo>();
      for (const u of authUsers) {
        const meta = u.raw_user_meta_data;
        const name = meta?.full_name ?? meta?.name ?? u.email?.split('@')[0] ?? u.id.slice(0, 8);
        const avatarUrl = meta?.avatar_url;
        result.set(u.id, { email: u.email ?? u.id.slice(0, 8), name, avatarUrl });
      }
      // Add members not found with fallback values
      for (const m of rawMembers) {
        if (!result.has(m.user_id)) {
          result.set(m.user_id, { email: m.user_id.slice(0, 8), name: m.user_id.slice(0, 8) });
        }
      }
      return result;
    }
  } catch {
    // Service role unavailable — fallback below
  }

  // Final fallback: try admin API
  try {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
    const admin = createAdminSupabaseClient();
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 100 });

    if (usersData?.users) {
      const memberIdSet = new Set(memberIds);
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
  } catch {
    // Admin client also unavailable
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
