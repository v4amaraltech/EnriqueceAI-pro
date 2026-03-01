'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { inviteMemberSchema } from '../schemas/member.schemas';
import { checkMemberLimit } from '../services/member-limits.service';

export async function inviteMember(formData: FormData): Promise<ActionResult<void>> {
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

    // Build redirect URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const redirectTo = `${appUrl}/api/auth/callback`;

    // Use admin client to invite user (creates user if new, sends invite email)
    const admin = createAdminSupabaseClient();
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email,
      {
        redirectTo,
        data: {
          invited_to_org: currentMember.org_id,
          invited_role: parsed.data.role,
        },
      },
    );

    if (inviteError) {
      // User already exists and is confirmed — send magic link instead
      if (inviteError.message?.includes('already been registered') || inviteError.code === 'email_exists') {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: parsed.data.email,
          options: { emailRedirectTo: redirectTo },
        });
        if (otpError) {
          return { success: false, error: otpError.message, code: otpError.code };
        }

        // Look up existing user ID
        const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 100 });
        const existingUser = usersData?.users?.find((u) => u.email === parsed.data.email);

        if (existingUser) {
          // Create invited member record for existing user
          await admin.from('organization_members').upsert(
            {
              org_id: currentMember.org_id,
              user_id: existingUser.id,
              role: parsed.data.role,
              status: 'invited',
            },
            { onConflict: 'org_id,user_id' },
          );
        }
      } else {
        return { success: false, error: inviteError.message, code: inviteError.code };
      }
    } else if (inviteData?.user) {
      // New user created — create organization_members record with status='invited'
      const { error: memberError } = await admin.from('organization_members').insert({
        org_id: currentMember.org_id,
        user_id: inviteData.user.id,
        role: parsed.data.role,
        status: 'invited',
      });

      if (memberError && !memberError.message?.includes('duplicate')) {
        console.error('Error creating invited member record:', memberError);
      }
    }

    // Notify org managers about the invite
    createNotificationsForOrgMembers({
      orgId: currentMember.org_id,
      type: 'member_invited',
      title: 'Novo membro convidado',
      body: `${parsed.data.email} foi convidado como ${parsed.data.role}`,
      resourceType: 'member',
      metadata: { email: parsed.data.email, role: parsed.data.role },
      roleFilter: 'manager',
      excludeUserId: user.id,
    }).catch((err) => console.error('Failed to create invite notification:', err));

    revalidatePath('/settings/users');
    return { success: true, data: undefined };
  } catch (error) {
    // Re-throw Next.js redirects and other non-error throws
    if (error instanceof Error && error.message?.includes('NEXT_REDIRECT')) throw error;
    console.error('Error in inviteMember:', error);
    return { success: false, error: 'Erro ao enviar convite' };
  }
}
