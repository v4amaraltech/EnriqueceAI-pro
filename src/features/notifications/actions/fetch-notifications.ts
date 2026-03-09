'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchNotificationsSchema } from '../schemas/notification.schemas';
import type { NotificationRow } from '../types';

export interface FetchNotificationsResult {
  data: NotificationRow[];
  total: number;
  unread_count: number;
}

export async function fetchNotifications(
  rawParams: Record<string, unknown>,
): Promise<ActionResult<FetchNotificationsResult>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const parsed = fetchNotificationsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return { success: false, error: 'Parâmetros inválidos' };
  }

  const { limit, offset, unread_only } = parsed.data;

  // Get user's org
  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Fetch notifications
  let query = from(supabase, 'notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .eq('org_id', member.org_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (unread_only) {
    query = query.is('read_at', null);
  }

  const { data, count, error } = (await query) as {
    data: NotificationRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar notificações' };
  }

  // Get unread count
  const { count: unreadCount } = (await from(supabase, 'notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('org_id', member.org_id)
    .is('read_at', null)) as { count: number | null };

  return {
    success: true,
    data: {
      data: data ?? [],
      total: count ?? 0,
      unread_count: unreadCount ?? 0,
    },
  };
}
