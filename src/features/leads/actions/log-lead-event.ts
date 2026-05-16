'use server';

import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Log a system event to the interactions table for lead timeline tracking.
 * Non-blocking — errors are silently caught to not break the main operation.
 */
function extractRefs(metadata?: Record<string, unknown>): { cadence_id: string | null; step_id: string | null } {
  const cadence_id = typeof metadata?.cadence_id === 'string' ? metadata.cadence_id : null;
  const step_id = typeof metadata?.step_id === 'string' ? metadata.step_id : null;
  return { cadence_id, step_id };
}

export async function logLeadEvent(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  params: {
    orgId: string;
    leadId: string;
    userId: string;
    event: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // Promote cadence_id / step_id from metadata into the top-level columns.
    // Without this, queries that filter interactions by cadence_id (cadence
    // analytics, step performance) miss every system event — we observed
    // 1104 cadence_enrolled rows on V4 Amaral with NULL cadence_id.
    const refs = extractRefs(params.metadata);
    await from(supabase, 'interactions').insert({
      org_id: params.orgId,
      lead_id: params.leadId,
      cadence_id: refs.cadence_id,
      step_id: refs.step_id,
      channel: 'system',
      type: 'sent',
      message_content: params.message,
      performed_by: params.userId,
      metadata: { system_event: params.event, ...params.metadata },
    } as Record<string, unknown>);
  } catch (err) {
    console.warn('[logLeadEvent] Failed to log event:', params.event, err);
  }
}

/**
 * Log a system event for multiple leads at once.
 */
export async function logLeadEventBulk(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  params: {
    orgId: string;
    leadIds: string[];
    userId: string;
    event: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (params.leadIds.length === 0) return;
  try {
    const refs = extractRefs(params.metadata);
    const rows = params.leadIds.map((leadId) => ({
      org_id: params.orgId,
      lead_id: leadId,
      cadence_id: refs.cadence_id,
      step_id: refs.step_id,
      channel: 'system',
      type: 'sent',
      message_content: params.message,
      performed_by: params.userId,
      metadata: { system_event: params.event, ...params.metadata },
    }));
    await from(supabase, 'interactions').insert(rows as Record<string, unknown>[]);
  } catch (err) {
    console.warn('[logLeadEventBulk] Failed to log events:', params.event, err);
  }
}
