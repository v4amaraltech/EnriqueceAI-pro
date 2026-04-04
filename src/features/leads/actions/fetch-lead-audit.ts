'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface AuditLogEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
  user_name: string | null;
}

export async function fetchLeadAudit(leadId: string): Promise<ActionResult<AuditLogEntry[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = await from(supabase, 'audit_log')
    .select('id, action, metadata, created_at, user_id')
    .eq('org_id', orgId)
    .eq('resource_type', 'lead')
    .eq('resource_id', leadId)
    .order('created_at', { ascending: false })
    .limit(100) as {
      data: Array<{ id: string; action: string; metadata: Record<string, unknown>; created_at: string; user_id: string | null }> | null;
      error: { message: string } | null;
    };

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data || data.length === 0) {
    return { success: true, data: [] };
  }

  // Fetch user names for all unique user_ids
  const userIds = [...new Set(data.filter((d) => d.user_id).map((d) => d.user_id!))];
  let userMap = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: members } = await from(supabase, 'organization_members')
      .select('user_id, name')
      .eq('org_id', orgId)
      .in('user_id', userIds) as { data: Array<{ user_id: string; name: string }> | null };

    if (members) {
      userMap = new Map(members.map((m) => [m.user_id, m.name]));
    }
  }

  const entries: AuditLogEntry[] = data.map((d) => ({
    id: d.id,
    action: d.action,
    metadata: d.metadata,
    created_at: d.created_at,
    user_name: d.user_id ? (userMap.get(d.user_id) ?? null) : null,
  }));

  return { success: true, data: entries };
}
