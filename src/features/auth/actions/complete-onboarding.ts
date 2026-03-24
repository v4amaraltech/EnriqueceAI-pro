'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface OnboardingInput {
  orgName: string;
  orgSlug?: string;
}

export async function completeOnboarding(
  input: OnboardingInput,
): Promise<ActionResult<{ orgId: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const orgName = input.orgName.trim();
  if (!orgName || orgName.length < 2) {
    return { success: false, error: 'Nome da empresa deve ter pelo menos 2 caracteres' };
  }

  // Fetch role for permission check
  const { data: member } = (await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .single()) as { data: { role: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  if (member.role !== 'manager') {
    return { success: false, error: 'Sem permissão para configurar a organização' };
  }

  // Generate slug from name
  const baseSlug = orgName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const slug = input.orgSlug?.trim() || `${baseSlug}-${Date.now().toString(36)}`;

  // Update organization name and advance to step 1
  const { error: updateError } = await from(supabase, 'organizations')
    .update({ name: orgName, slug, onboarding_step: 1 } as Record<string, unknown>)
    .eq('id', orgId);

  if (updateError) {
    return { success: false, error: 'Falha ao atualizar organização' };
  }

  return { success: true, data: { orgId } };
}

/**
 * Checks if the current user's org needs onboarding.
 * Uses onboarding_step column (NOT NULL = still onboarding).
 * Falls back to domain name heuristic for orgs created before the migration.
 */
export async function checkNeedsOnboarding(): Promise<number | false> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: member } = (await from(supabase, 'organization_members')
    .select('organization:organizations(name, onboarding_step)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { organization: { name: string; onboarding_step: number | null } } | null };

  if (!member?.organization) return false;

  // If onboarding_step is set, return it (0-5 = current step)
  if (member.organization.onboarding_step !== null && member.organization.onboarding_step !== undefined) {
    return member.organization.onboarding_step;
  }

  // Fallback for orgs created before the migration: check domain name heuristic
  const name = member.organization.name;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name)) {
    return 0;
  }

  return false;
}
