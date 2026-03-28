'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export async function markAllNotificationsRead(): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, supabase } = auth.data;

  const { error } = await from(supabase, 'notifications')
    .update({ read_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) {
    return { success: false, error: 'Erro ao marcar notificações como lidas' };
  }

  return { success: true, data: undefined };
}
