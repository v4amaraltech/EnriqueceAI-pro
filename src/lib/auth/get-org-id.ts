import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { effectiveRole } from './dev-view-as';
import type { MemberRole } from './require-auth-with-member';
import { requireAuth } from './require-auth';
import { requireManager } from './require-manager';

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

// `role` viaja junto para que as Server Actions possam escopar a "posse" (leads
// atribuídos ao SDR) sem uma segunda query — a busca do membro já traz o papel.
type OrgContext = { orgId: string; userId: string; role: MemberRole; supabase: SupabaseClient };

async function fetchMember(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ orgId: string; role: MemberRole } | null> {
  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { org_id: string; role: MemberRole } | null };

  return member ? { orgId: member.org_id, role: await effectiveRole(member.role) } : null;
}

/**
 * Get org ID for an authenticated user. Returns ActionResult with org context.
 * Use this in Server Actions that return ActionResult<T>.
 */
export async function getAuthOrgIdResult(): Promise<ActionResult<OrgContext>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();
  const member = await fetchMember(supabase, user.id);

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  return { success: true, data: { orgId: member.orgId, userId: user.id, role: member.role, supabase } };
}

/**
 * @deprecated Use `getAuthOrgIdResult()` instead — it returns ActionResult<T> for proper error handling.
 * Get org ID for an authenticated user. Calls requireAuth() internally.
 * Returns { orgId, userId, supabase } or throws redirect to /login.
 */
export async function getAuthOrgId(): Promise<{
  orgId: string;
  userId: string;
  supabase: SupabaseClient;
}> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();
  const member = await fetchMember(supabase, user.id);

  if (!member) throw new Error('Organização não encontrada');

  return { orgId: member.orgId, userId: user.id, supabase };
}

/**
 * Get org ID for a manager user. Calls requireManager() internally.
 * Returns { orgId, userId, supabase } or throws redirect.
 */
export async function getManagerOrgId(): Promise<{
  orgId: string;
  userId: string;
  supabase: SupabaseClient;
}> {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();
  const member = await fetchMember(supabase, user.id);

  if (!member) throw new Error('Organização não encontrada');

  return { orgId: member.orgId, userId: user.id, supabase };
}
