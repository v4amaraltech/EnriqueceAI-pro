'use server';

import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { requireAuth } from '@/lib/auth/require-auth';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { OrgMember } from '../types/shared';

export async function getManagerOrgId(): Promise<{ orgId: string }> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) throw new Error('Organização não encontrada');

  return { orgId: member.org_id };
}

/**
 * Fetch organization members for filter dropdowns.
 * Uses safe auth (no redirect) to avoid crashing Promise.all in pages.
 * Returns [] on any auth/query failure — page-level guards handle redirects.
 */
export async function fetchOrgMembers(): Promise<OrgMember[]> {
  try {
    const user = await requireAuth();
    const supabase = await createServerSupabaseClient();

    const { data: member } = (await from(supabase, 'organization_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()) as { data: { org_id: string; role: string } | null };

    // Only managers see the member filter
    if (!member || member.role !== 'manager') return [];

    const { data: members } = (await from(supabase, 'organization_members')
      .select('user_id')
      .eq('org_id', member.org_id)
      .eq('status', 'active')) as { data: { user_id: string }[] | null };

    if (!members?.length) return [];

    // Look up emails and names via admin client (organization_members has no email/name column)
    const userMap = new Map<string, { email: string; name?: string }>();
    try {
      const admin = createAdminSupabaseClient();
      const memberIds = new Set(members.map((m) => m.user_id));
      const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 100 });
      if (usersData?.users) {
        for (const u of usersData.users) {
          if (memberIds.has(u.id)) {
            const name = (u.user_metadata?.name as string) || (u.user_metadata?.full_name as string) || undefined;
            userMap.set(u.id, { email: u.email ?? u.id.slice(0, 8), name });
          }
        }
      }
    } catch {
      // Admin client unavailable — fallback to truncated IDs
    }

    return members.map((m) => {
      const info = userMap.get(m.user_id);
      return {
        userId: m.user_id,
        email: info?.email ?? m.user_id.slice(0, 8),
        name: info?.name,
      };
    });
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so they propagate correctly
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return [];
  }
}
