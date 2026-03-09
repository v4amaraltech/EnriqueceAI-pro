import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { NotificationInsert, NotificationType } from '../types';

export async function createNotification(params: NotificationInsert): Promise<{ id: string }> {
  const supabase = createServiceRoleClient();

  const { data, error } = (await from(supabase, 'notifications')
    .insert(params as unknown as Record<string, unknown>)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) {
    throw new Error(`Failed to create notification: ${error?.message ?? 'unknown error'}`);
  }

  return data;
}

export async function createNotificationsForOrgMembers(params: {
  orgId: string;
  type: NotificationType;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  roleFilter?: string;
  excludeUserId?: string;
}): Promise<void> {
  const supabase = createServiceRoleClient();

  // Fetch active members of the org
  let query = from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', params.orgId)
    .eq('status', 'active');

  if (params.roleFilter) {
    query = query.eq('role', params.roleFilter);
  }

  const { data: members, error: membersError } = (await query) as {
    data: Array<{ user_id: string }> | null;
    error: { message: string } | null;
  };

  if (membersError || !members) {
    throw new Error(`Failed to fetch org members: ${membersError?.message ?? 'unknown error'}`);
  }

  const notifications: NotificationInsert[] = members
    .filter((m) => m.user_id !== params.excludeUserId)
    .map((m) => ({
      org_id: params.orgId,
      user_id: m.user_id,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      resource_type: params.resourceType ?? null,
      resource_id: params.resourceId ?? null,
      metadata: params.metadata ?? {},
    }));

  if (notifications.length === 0) return;

  const { error: insertError } = await from(supabase, 'notifications')
    .insert(notifications as unknown as Record<string, unknown>[]);

  if (insertError) {
    throw new Error(`Failed to create notifications: ${insertError.message}`);
  }
}
