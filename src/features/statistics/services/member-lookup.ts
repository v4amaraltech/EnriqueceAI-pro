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

  // Resolve each member individually via auth.admin.getUserById
  // (listUsers fails with "Database error finding users" on this project)
  try {
    const { createServiceRoleClient } = await import('@/lib/supabase/service');
    const service = createServiceRoleClient();
    const result = new Map<string, MemberInfo>();

    await Promise.all(
      rawMembers.map(async (m) => {
        const { data, error } = await service.auth.admin.getUserById(m.user_id);
        if (error || !data?.user) {
          console.error(`[member-lookup] getUserById(${m.user_id.slice(0, 8)}) error:`, error?.message);
          result.set(m.user_id, { email: m.user_id.slice(0, 8), name: m.user_id.slice(0, 8) });
          return;
        }
        const u = data.user;
        const meta = u.user_metadata as Record<string, string> | undefined;
        const name = meta?.full_name ?? meta?.name ?? u.email?.split('@')[0] ?? u.id.slice(0, 8);
        const avatarUrl = meta?.avatar_url;
        result.set(u.id, { email: u.email ?? u.id.slice(0, 8), name, avatarUrl });
      }),
    );

    return result;
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
