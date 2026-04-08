'use server';

import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Log a system event to the interactions table for lead timeline tracking.
 * Non-blocking — errors are silently caught to not break the main operation.
 */
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
    await from(supabase, 'interactions').insert({
      org_id: params.orgId,
      lead_id: params.leadId,
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
    const rows = params.leadIds.map((leadId) => ({
      org_id: params.orgId,
      lead_id: leadId,
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
