'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { inviteMemberSchema } from '../schemas/member.schemas';
import { checkMemberLimit } from '../services/member-limits.service';

const TEMP_PASSWORD = 'Enriqueceai123';

export async function inviteMember(
  formData: FormData,
): Promise<ActionResult<{ tempPassword: string | null }>> {
  try {
    const user = await requireManager();

    const raw = {
      email: formData.get('email'),
      role: formData.get('role'),
    };

    const parsed = inviteMemberSchema.safeParse(raw);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
    }

    const supabase = await createServerSupabaseClient();

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

    // Check member limit
    const limit = await checkMemberLimit(supabase, currentMember.org_id);
    if (!limit.allowed) {
      return {
        success: false,
        error: `Limite de membros atingido (${limit.current}/${limit.max}). Faça upgrade do plano para adicionar mais membros.`,
        code: 'MEMBER_LIMIT_REACHED',
      };
    }

    const admin = createAdminSupabaseClient();

    // Check if user already exists
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = usersData?.users?.find((u) => u.email === parsed.data.email);

    let tempPassword: string | null = null;

    if (existingUser) {
      // User already exists — just add to org with active status
      await admin.from('organization_members').upsert(
        {
          org_id: currentMember.org_id,
          user_id: existingUser.id,
          role: parsed.data.role,
          status: 'active',
        },
        { onConflict: 'org_id,user_id' },
      );
    } else {
      // New user — create with temp password (email_confirm: true skips email verification)
      const { data: newUserData, error: createError } = await admin.auth.admin.createUser({
        email: parsed.data.email,
        password: TEMP_PASSWORD,
        email_confirm: true,
      });

      if (createError) {
        return { success: false, error: createError.message };
      }

      if (newUserData?.user) {
        // handle_new_user trigger already created an auto-org + auto-member
        // Delete the auto-created org (CASCADE will delete the auto-member + subscription)
        const { data: autoOrgMember } = (await admin
          .from('organization_members')
          .select('org_id')
          .eq('user_id', newUserData.user.id)
          .eq('role', 'manager')
          .eq('status', 'active')
          .single()) as { data: { org_id: string } | null };

        if (autoOrgMember && autoOrgMember.org_id !== currentMember.org_id) {
          await admin.from('organizations').delete().eq('id', autoOrgMember.org_id);
        }

        // Create org member in the invited org with active status
        const { error: memberError } = await admin.from('organization_members').insert({
          org_id: currentMember.org_id,
          user_id: newUserData.user.id,
          role: parsed.data.role,
          status: 'active',
        });

        if (memberError && !memberError.message?.includes('duplicate')) {
          console.error('Error creating member record:', memberError);
        }

        tempPassword = TEMP_PASSWORD;
      }
    }

    // Notify org managers about the new member
    createNotificationsForOrgMembers({
      orgId: currentMember.org_id,
      type: 'member_invited',
      title: 'Novo membro adicionado',
      body: `${parsed.data.email} foi adicionado como ${parsed.data.role}`,
      resourceType: 'member',
      metadata: { email: parsed.data.email, role: parsed.data.role },
      roleFilter: 'manager',
      excludeUserId: user.id,
    }).catch((err) => console.error('Failed to create invite notification:', err));

    revalidatePath('/settings/users');
    return { success: true, data: { tempPassword } };
  } catch (error) {
    // Re-throw Next.js redirects
    if (error instanceof Error && error.message?.includes('NEXT_REDIRECT')) throw error;
    console.error('Error in inviteMember:', error);
    return { success: false, error: 'Erro ao convidar membro' };
  }
}
