'use server';

import { from } from '@/lib/supabase/from';
import type { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Mark a lead as 'contacted' with contacted_at timestamp if the lead is still 'new'.
 * No-op if lead already has a different status. Non-blocking — errors are silently caught.
 */
export async function markLeadContacted(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  leadId: string,
): Promise<void> {
  try {
    await from(supabase, 'leads')
      .update({ status: 'contacted', contacted_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('status', 'new');
  } catch {
    // Non-blocking
  }
}
