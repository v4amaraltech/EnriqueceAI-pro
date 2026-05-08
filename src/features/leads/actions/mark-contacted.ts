'use server';

import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Records the first-contact moment on a lead. Two updates:
 * - If status is still 'new', advance to 'contacted' (this carries the
 *   timestamp along).
 * - If status is anything else but contacted_at is still NULL (a manager
 *   may have moved the lead manually before the first send landed), only
 *   stamp contacted_at — without forcing status back to 'contacted'.
 *
 * Non-blocking — errors are silently caught.
 */
export async function markLeadContacted(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  leadId: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await from(supabase, 'leads')
      .update({ status: 'contacted', contacted_at: now } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('status', 'new');

    await from(supabase, 'leads')
      .update({ contacted_at: now } as Record<string, unknown>)
      .eq('id', leadId)
      .is('contacted_at', null);
  } catch {
    // Non-blocking
  }
}
