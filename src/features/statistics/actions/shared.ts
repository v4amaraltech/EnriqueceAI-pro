'use server';

import { requireAuth } from '@/lib/auth/require-auth';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { buildMemberInfoMap } from '../services/member-lookup';
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

    const infoMap = await buildMemberInfoMap(supabase, member.org_id);

    return Array.from(infoMap.entries()).map(([userId, info]) => ({
      userId,
      email: info.email,
      name: info.name,
    }));
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
