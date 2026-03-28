'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/utils/app-url';

const INVITE_EXPIRY_DAYS = 7;

export async function resendInvite(
  memberId: string,
): Promise<ActionResult<{ email: string }>> {
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
      .select('user_id, org_id, status')
      .eq('id', memberId)
      .single()) as { data: { user_id: string; org_id: string; status: string } | null };

    if (!invitedMember || invitedMember.org_id !== currentMember.org_id) {
      return { success: false, error: 'Membro não encontrado' };
    }

    if (invitedMember.status !== 'invited') {
      return { success: false, error: 'Este membro não tem um convite pendente' };
    }

    // Get user email
    const { data: userData } = await admin.auth.admin.getUserById(invitedMember.user_id);
    const email = userData?.user?.email;
    if (!email) {
      return { success: false, error: 'Email do usuário não encontrado' };
    }

    // Resend invite
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${getAppUrl()}/api/auth/confirm`,
    });

    if (inviteError) {
      return { success: false, error: inviteError.message };
    }

    // Reset expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    await from(admin, 'organization_members')
      .update({ invited_expires_at: expiresAt.toISOString(), updated_at: new Date().toISOString() })
      .eq('id', memberId);

    revalidatePath('/settings/users');
    return { success: true, data: { email } };
  } catch (error) {
    if (error instanceof Error && error.message?.includes('NEXT_REDIRECT')) throw error;
    console.error('Error in resendInvite:', error);
    return { success: false, error: 'Erro ao reenviar convite' };
  }
}
