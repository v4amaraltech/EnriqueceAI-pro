import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';

export interface MemberInfo {
  email: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Build a map of user_id → {email, name} for organization members.
 * Looks up auth.users (via resolveUserProfiles) since organization_members
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

  // Names/e-mails from auth.users in one query; unresolved ids fall back to the id prefix
  const profiles = await resolveUserProfiles(rawMembers.map((m) => m.user_id));
  return new Map(
    rawMembers.map((m) => {
      const p = profiles.get(m.user_id);
      const short = m.user_id.slice(0, 8);
      return [
        m.user_id,
        p ? { email: p.email ?? short, name: p.displayName, avatarUrl: p.avatarUrl ?? undefined } : { email: short, name: short },
      ];
    }),
  );
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
