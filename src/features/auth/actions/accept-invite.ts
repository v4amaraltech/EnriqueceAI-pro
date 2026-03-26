'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

export async function acceptPendingInvite(): Promise<ActionResult<{ orgId: string } | null>> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Não autenticado' };
    }

    // Use service role to bypass RLS — invited members can't read/update their own record
    const serviceClient = createServiceRoleClient();

    // Check for pending invite matching user email
    // The invite was created with status='invited' before the user signed up
    const { data: invites } = (await from(serviceClient, 'organization_members')
      .select('id, org_id')
      .eq('user_id', user.id)
      .eq('status', 'invited')) as { data: Array<{ id: string; org_id: string }> | null };

    if (!invites || invites.length === 0) {
      return { success: true, data: null }; // No pending invite — normal signup
    }

    const invite = invites[0]!;

    // Find the auto-created org (where user is manager)
    const { data: autoOrgMember } = (await from(serviceClient, 'organization_members')
      .select('id, org_id')
      .eq('user_id', user.id)
      .eq('role', 'manager')
      .eq('status', 'active')
      .single()) as { data: { id: string; org_id: string } | null };

    if (autoOrgMember && autoOrgMember.org_id !== invite.org_id) {
      // Delete auto-created org member record (cascade will clean up)
      await from(serviceClient, 'organizations')
        .delete()
        .eq('id', autoOrgMember.org_id);
    }

    // Accept the invite
    const { error } = await from(serviceClient, 'organization_members')
      .update({ status: 'active', accepted_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', invite.id);

    if (error) {
      return { success: false, error: error.message };
    }

    // Notify org managers about the new member
    createNotificationsForOrgMembers({
      orgId: invite.org_id,
      type: 'member_joined',
      title: 'Novo membro na organização',
      body: `${user.email ?? 'Um usuário'} aceitou o convite`,
      resourceType: 'member',
      metadata: { email: user.email },
      roleFilter: 'manager',
      excludeUserId: user.id,
    }).catch((err) => console.error('Failed to create join notification:', err));

    return { success: true, data: { orgId: invite.org_id } };
  } catch (error) {
    // Re-throw Next.js redirects and other non-error throws
    if (error instanceof Error && error.message?.includes('NEXT_REDIRECT')) throw error;
    console.error('Error in acceptPendingInvite:', error);
    return { success: false, error: 'Erro ao aceitar convite' };
  }
}
