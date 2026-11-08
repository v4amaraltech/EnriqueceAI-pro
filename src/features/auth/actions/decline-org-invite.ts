'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

const memberIdSchema = z.string().uuid();

/**
 * Recusa EXPLÍCITA, feita pelo próprio usuário autenticado, de um convite
 * pendente (status 'invited'). Só afeta a linha cujo user_id é o da sessão;
 * nunca toca em organizações nem em memberships ativos.
 */
export async function declineOrgInvite(memberId: string): Promise<ActionResult<{ orgId: string }>> {
  try {
    const parsedId = memberIdSchema.safeParse(memberId);
    if (!parsedId.success) return { success: false, error: 'Convite inválido' };

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    const service = createServiceRoleClient();

    const { data: invite } = (await from(service, 'organization_members')
      .select('id, org_id, user_id, status')
      .eq('id', parsedId.data)
      .maybeSingle()) as {
      data: { id: string; org_id: string; user_id: string; status: string } | null;
    };

    if (!invite || invite.user_id !== user.id || invite.status !== 'invited') {
      return { success: false, error: 'Convite não encontrado' };
    }

    const { error } = await from(service, 'organization_members')
      .update({ status: 'removed' } as Record<string, unknown>)
      .eq('id', invite.id)
      .eq('user_id', user.id)
      .eq('status', 'invited');
    if (error) {
      console.error('[declineOrgInvite] update failed:', error);
      return { success: false, error: 'Erro ao recusar convite' };
    }

    revalidatePath('/convites');
    return { success: true, data: { orgId: invite.org_id } };
  } catch (error) {
    if (error instanceof Error && error.message?.includes('NEXT_REDIRECT')) throw error;
    console.error('Error in declineOrgInvite:', error);
    return { success: false, error: 'Erro ao recusar convite' };
  }
}
