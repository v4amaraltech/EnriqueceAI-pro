'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { isDisposableSoloOrg } from '../services/disposable-org';

const memberIdSchema = z.string().uuid();

/**
 * Aceite EXPLÍCITO, feito pelo próprio usuário autenticado, de um convite
 * pendente para uma org (status 'invited'). É o único caminho pelo qual quem
 * já tem conta passa a ser membro ativo de outra org.
 *
 * - O convite precisa pertencer ao usuário da sessão e não estar expirado.
 * - Se o usuário já é membro ativo de outra org: só segue se essa org for a
 *   org solo vazia do cadastro (descartável). Org com dados ou com time nunca
 *   é apagada; o usuário precisa sair dela antes.
 */
export async function acceptOrgInvite(memberId: string): Promise<ActionResult<{ orgId: string }>> {
  try {
    const parsedId = memberIdSchema.safeParse(memberId);
    if (!parsedId.success) return { success: false, error: 'Convite inválido' };

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    // Service role: o convidado ainda não enxerga a linha via RLS. A posse é
    // verificada abaixo (user_id === usuário da sessão).
    const service = createServiceRoleClient();

    const { data: invite } = (await from(service, 'organization_members')
      .select('id, org_id, user_id, status, invited_expires_at')
      .eq('id', parsedId.data)
      .maybeSingle()) as {
      data: {
        id: string;
        org_id: string;
        user_id: string;
        status: string;
        invited_expires_at: string | null;
      } | null;
    };

    if (!invite || invite.user_id !== user.id || invite.status !== 'invited') {
      return { success: false, error: 'Convite não encontrado' };
    }
    if (invite.invited_expires_at && new Date(invite.invited_expires_at).getTime() < Date.now()) {
      return { success: false, error: 'Convite expirado. Peça um novo convite.' };
    }

    const { data: active } = (await from(service, 'organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('status', 'active')) as { data: Array<{ org_id: string }> | null };

    const others = (active ?? []).filter((m) => m.org_id !== invite.org_id);
    for (const other of others) {
      if (!(await isDisposableSoloOrg(service, other.org_id, user.id))) {
        return {
          success: false,
          error:
            'Você já pertence a outra organização com dados ou membros. Saia dela antes de aceitar este convite.',
        };
      }
    }
    for (const other of others) {
      const { error: delErr } = await from(service, 'organizations').delete().eq('id', other.org_id);
      if (delErr) {
        console.error('[acceptOrgInvite] Failed to delete empty solo org:', delErr);
        return { success: false, error: 'Erro ao aceitar convite' };
      }
    }

    const { error } = await from(service, 'organization_members')
      .update({ status: 'active', accepted_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', invite.id)
      .eq('user_id', user.id)
      .eq('status', 'invited');
    if (error) return { success: false, error: error.message };

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

    revalidatePath('/dashboard');
    return { success: true, data: { orgId: invite.org_id } };
  } catch (error) {
    if (error instanceof Error && error.message?.includes('NEXT_REDIRECT')) throw error;
    console.error('Error in acceptOrgInvite:', error);
    return { success: false, error: 'Erro ao aceitar convite' };
  }
}
