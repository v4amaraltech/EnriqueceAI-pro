'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { markNotificationReadSchema } from '../schemas/notification.schemas';

export async function markNotificationRead(
  rawParams: Record<string, unknown>,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, supabase } = auth.data;

  const parsed = markNotificationReadSchema.safeParse(rawParams);
  if (!parsed.success) {
    return { success: false, error: 'ID de notificação inválido' };
  }

  const { error } = await from(supabase, 'notifications')
    .update({ read_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', parsed.data.notification_id)
    .eq('user_id', userId);

  if (error) {
    return { success: false, error: 'Erro ao marcar notificação como lida' };
  }

  return { success: true, data: undefined };
}
