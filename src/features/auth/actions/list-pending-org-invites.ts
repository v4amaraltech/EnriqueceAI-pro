'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { listPendingOrgInvites, type PendingOrgInvite } from '../services/pending-org-invites';

/** Convites pendentes do usuário logado (somente os dele, pelo id da sessão). */
export async function fetchMyPendingOrgInvites(): Promise<ActionResult<PendingOrgInvite[]>> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Não autenticado' };

    const invites = await listPendingOrgInvites(createServiceRoleClient(), user.id);
    return { success: true, data: invites };
  } catch (error) {
    console.error('Error in fetchMyPendingOrgInvites:', error);
    return { success: false, error: 'Erro ao carregar convites' };
  }
}
