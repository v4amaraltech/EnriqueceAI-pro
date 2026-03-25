import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a map of user_id → display name for organization members.
 * Uses admin client to look up from auth.users since organization_members
 * does not have a user_email column.
 */
export async function buildMemberNameMap(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, string>> {
  const { data: rawMembers } = (await supabase
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: { user_id: string }[] | null };

  if (!rawMembers?.length) return new Map();

  const memberIds = new Set(rawMembers.map((m) => m.user_id));

  try {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
    const admin = createAdminSupabaseClient();
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 100 });

    if (usersData?.users) {
      return new Map(
        usersData.users
          .filter((u) => memberIds.has(u.id))
          .map((u) => {
            const meta = u.user_metadata as Record<string, string> | undefined;
            const name =
              meta?.full_name ?? meta?.name ?? u.email?.split('@')[0] ?? u.id.slice(0, 8);
            return [u.id, name];
          }),
      );
    }
  } catch {
    // Admin client unavailable — fallback to truncated IDs
  }

  return new Map(rawMembers.map((m) => [m.user_id, m.user_id.slice(0, 8)]));
}
