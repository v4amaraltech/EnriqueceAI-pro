'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function revokeInvite(
  memberId: string,
): Promise<ActionResult<null>> {
  try {
    const user = await requireManager();
    const supabase = await createServerSupabaseClient();
    const admin = createAdminSupabaseClient();

    // Get current user's org
    const { data: currentMember } = (await supabase
      .from('organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()) as { data: { org_id: string } | null };

    if (!currentMember) {
      return { success: false, error: 'Organização não encontrada' };
    }

    // Get the invited member
    const { data: invitedMember } = (await from(admin, 'organization_members')
      .select('org_id, status')
      .eq('id', memberId)
      .single()) as { data: { org_id: string; status: string } | null };

    if (!invitedMember || invitedMember.org_id !== currentMember.org_id) {
      return { success: false, error: 'Membro não encontrado' };
    }

    if (invitedMember.status !== 'invited') {
      return { success: false, error: 'Este membro não tem um convite pendente' };
    }

    // Set status to removed
    await from(admin, 'organization_members')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', memberId);

    revalidatePath('/settings/users');
    return { success: true, data: null };
  } catch (error) {
    if (error instanceof Error && error.message?.includes('NEXT_REDIRECT')) throw error;
    console.error('Error in revokeInvite:', error);
    return { success: false, error: 'Erro ao revogar convite' };
  }
}
