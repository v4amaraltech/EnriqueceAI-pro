'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { updateMemberRoleSchema } from '../schemas/member.schemas';

export async function updateMemberRole(formData: FormData): Promise<ActionResult<void>> {
  await requireManager();

  const raw = {
    memberId: formData.get('memberId'),
    role: formData.get('role'),
  };

  const parsed = updateMemberRoleSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createServerSupabaseClient();

  // Get the member to validate
  const { data: member } = (await from(supabase, 'organization_members')
    .select('user_id, org_id')
    .eq('id', parsed.data.memberId)
    .single()) as { data: { user_id: string; org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Membro não encontrado' };
  }

  // Cannot change role of org owner
  const { data: org } = (await from(supabase, 'organizations')
    .select('owner_id')
    .eq('id', member.org_id)
    .single()) as { data: { owner_id: string } | null };

  if (org && member.user_id === org.owner_id) {
    return { success: false, error: 'Não é possível alterar o role do proprietário da organização' };
  }

  // Update role
  const { error } = await from(supabase, 'organization_members')
    .update({ role: parsed.data.role, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', parsed.data.memberId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/settings/users');
  return { success: true, data: undefined };
}
