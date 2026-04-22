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
  /** Map of closer UUIDs → names for resolving closer_id changes */
  closerNames?: Record<string, string>;
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

  // Collect closer_ids from changes to resolve names
  const closerIds = new Set<string>();
  for (const d of data) {
    const changes = d.metadata?.changes as Record<string, { from: unknown; to: unknown }> | undefined;
    if (changes?.closer_id) {
      if (typeof changes.closer_id.from === 'string' && changes.closer_id.from) closerIds.add(changes.closer_id.from);
      if (typeof changes.closer_id.to === 'string' && changes.closer_id.to) closerIds.add(changes.closer_id.to);
    }
  }

  let closerMap: Record<string, string> = {};
  if (closerIds.size > 0) {
    const { data: closers } = await from(supabase, 'closers')
      .select('id, name')
      .in('id', [...closerIds]) as { data: Array<{ id: string; name: string }> | null };
    if (closers) {
      closerMap = Object.fromEntries(closers.map((c) => [c.id, c.name]));
    }
  }

  const entries: AuditLogEntry[] = data.map((d) => ({
    id: d.id,
    action: d.action,
    metadata: d.metadata,
    created_at: d.created_at,
    user_name: d.user_id ? (userMap.get(d.user_id) ?? null) : null,
    closerNames: Object.keys(closerMap).length > 0 ? closerMap : undefined,
  }));

  return { success: true, data: entries };
}
