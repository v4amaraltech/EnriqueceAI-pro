'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

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
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const parsed = fetchNotificationsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return { success: false, error: 'Parâmetros inválidos' };
  }

  const { limit, offset, unread_only } = parsed.data;

  // Fetch notifications
  let query = from(supabase, 'notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .eq('org_id', orgId)
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
    .eq('user_id', userId)
    .eq('org_id', orgId)
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
