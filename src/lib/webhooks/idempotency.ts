import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

/**
 * Check if a webhook event has already been processed.
 * Uses the `webhook_events` table with unique(provider, event_id) constraint.
 */
export async function isEventProcessed(
  supabase: SupabaseClient,
  provider: string,
  eventId: string,
): Promise<boolean> {
  const { data } = await from(supabase, 'webhook_events')
    .select('id')
    .eq('provider', provider)
    .eq('event_id', eventId)
    .maybeSingle();

  return data !== null;
}

/**
 * Mark a webhook event as received (pending processing).
 * Inserts with status='pending' and retry_count=0.
 * Uses upsert with ignoreDuplicates for race-safety.
 */
export async function markEventReceived(
  supabase: SupabaseClient,
  provider: string,
  eventId: string,
  eventType: string,
  payload?: unknown,
  orgId?: string,
): Promise<void> {
  await from(supabase, 'webhook_events').upsert(
    {
      provider,
      event_id: eventId,
      event_type: eventType,
      payload: payload ?? null,
      status: 'pending',
      retry_count: 0,
      ...(orgId ? { org_id: orgId } : {}),
    },
    { onConflict: 'provider,event_id', ignoreDuplicates: true },
  );
}

/**
 * Mark a webhook event as processed by inserting into `webhook_events`.
 * Uses ON CONFLICT DO NOTHING to safely handle race conditions.
 */
export async function markEventProcessed(
  supabase: SupabaseClient,
  provider: string,
  eventId: string,
  eventType: string,
  payload?: unknown,
  orgId?: string,
): Promise<void> {
  await from(supabase, 'webhook_events').upsert(
    {
      provider,
      event_id: eventId,
      event_type: eventType,
      payload: payload ?? null,
      processed_at: new Date().toISOString(),
      ...(orgId ? { org_id: orgId } : {}),
    },
    { onConflict: 'provider,event_id', ignoreDuplicates: true },
  );
}
