'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getManagerOrgId } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { updateMemberStatusSchema } from '../schemas/member.schemas';

export async function updateMemberStatus(formData: FormData): Promise<ActionResult<void>> {
  try {
    const { orgId: callerOrgId, userId, supabase } = await getManagerOrgId();

    const raw = {
      memberId: formData.get('memberId'),
      status: formData.get('status'),
    };

    const parsed = updateMemberStatusSchema.safeParse(raw);
    if (!parsed.success) {
      return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
    }

    // Get the member to validate — confirma que pertence à org do caller
    // (defense-in-depth contra IDOR cross-org, além da RLS).
    const { data: member } = (await from(supabase, 'organization_members')
      .select('user_id, org_id, role')
      .eq('id', parsed.data.memberId)
      .single()) as { data: { user_id: string; org_id: string; role: string } | null };

    if (!member || member.org_id !== callerOrgId) {
      return { success: false, error: 'Membro não encontrado' };
    }

    // Cannot deactivate yourself
    if (member.user_id === userId) {
      return { success: false, error: 'Não é possível alterar seu próprio status' };
    }

    // Cannot deactivate org owner
    const { data: org } = (await from(supabase, 'organizations')
      .select('owner_id')
      .eq('id', member.org_id)
      .single()) as { data: { owner_id: string } | null };

    if (org && member.user_id === org.owner_id) {
      return { success: false, error: 'Não é possível desativar o proprietário da organização' };
    }

    // Update status — escopado por org_id (defense-in-depth).
    const { error } = await from(supabase, 'organization_members')
      .update({ status: parsed.data.status, updated_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', parsed.data.memberId)
      .eq('org_id', callerOrgId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/settings/users');
    return { success: true, data: undefined };
  } catch (error) {
    console.error('[updateMemberStatus] Unhandled error:', error);
    return { success: false, error: 'Erro ao atualizar status do membro.' };
  }
}
