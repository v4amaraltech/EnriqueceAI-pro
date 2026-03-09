'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { markNotificationReadSchema } from '../schemas/notification.schemas';

export async function markNotificationRead(
  rawParams: Record<string, unknown>,
): Promise<ActionResult<void>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const parsed = markNotificationReadSchema.safeParse(rawParams);
  if (!parsed.success) {
    return { success: false, error: 'ID de notificação inválido' };
  }

  const { error } = await from(supabase, 'notifications')
    .update({ read_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', parsed.data.notification_id)
    .eq('user_id', user.id);

  if (error) {
    return { success: false, error: 'Erro ao marcar notificação como lida' };
  }

  return { success: true, data: undefined };
}
