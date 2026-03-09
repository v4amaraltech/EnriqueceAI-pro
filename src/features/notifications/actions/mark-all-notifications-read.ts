'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function markAllNotificationsRead(): Promise<ActionResult<void>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { error } = await from(supabase, 'notifications')
    .update({ read_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('user_id', user.id)
    .is('read_at', null);

  if (error) {
    return { success: false, error: 'Erro ao marcar notificações como lidas' };
  }

  return { success: true, data: undefined };
}
