import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

interface AuditEntry {
  orgId: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log an auditable action. Fire-and-forget — never blocks the caller.
 * Uses service role to bypass RLS (audit_log has no INSERT policy for members).
 */
export function logAudit(entry: AuditEntry): void {
  const supabase = createServiceRoleClient();

  from(supabase, 'audit_log')
    .insert({
      org_id: entry.orgId,
      user_id: entry.userId ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
    } as Record<string, unknown>)
    .then(({ error }: { error: unknown }) => {
      if (error) console.error('[audit] Failed to log:', entry.action, error);
    });
}
