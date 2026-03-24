import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { requireAuth } from './require-auth';
import { requireManager } from './require-manager';

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type OrgContext = { orgId: string; userId: string; supabase: SupabaseClient };

async function fetchOrgId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  return member?.org_id ?? null;
}

/**
 * Get org ID for an authenticated user. Returns ActionResult with org context.
 * Use this in Server Actions that return ActionResult<T>.
 */
export async function getAuthOrgIdResult(): Promise<ActionResult<OrgContext>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();
  const orgId = await fetchOrgId(supabase, user.id);

  if (!orgId) {
    return { success: false, error: 'Organização não encontrada' };
  }

  return { success: true, data: { orgId, userId: user.id, supabase } };
}

/**
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
  const orgId = await fetchOrgId(supabase, user.id);

  if (!orgId) throw new Error('Organização não encontrada');

  return { orgId, userId: user.id, supabase };
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
  const orgId = await fetchOrgId(supabase, user.id);

  if (!orgId) throw new Error('Organização não encontrada');

  return { orgId, userId: user.id, supabase };
}
