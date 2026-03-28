import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

export interface ProcessWithRetryOptions {
  supabase: SupabaseClient;
  provider: string;
  eventId: string;
  eventType: string;
  process: () => Promise<void>;
  maxRetries?: number;
}

/**
 * Process a webhook event with exponential backoff retry.
 * On final failure, marks the event as 'dead_letter'.
 *
 * Retry delay: attempt^2 * 1000ms (1s, 4s on attempt 2)
 */
export async function processWithRetry({
  supabase,
  provider,
  eventId,
  eventType,
  process,
  maxRetries = 3,
}: ProcessWithRetryOptions): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await process();

      // Success — mark as processed
      await from(supabase, 'webhook_events')
        .update({
          status: 'processed',
          retry_count: attempt - 1,
          processed_at: new Date().toISOString(),
        })
        .eq('provider', provider)
        .eq('event_id', eventId);

      return;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isFinalAttempt = attempt === maxRetries;

      await from(supabase, 'webhook_events')
        .update({
          status: isFinalAttempt ? 'dead_letter' : 'failed',
          retry_count: attempt,
          last_error: errorMessage,
          event_type: eventType,
        })
        .eq('provider', provider)
        .eq('event_id', eventId);

      if (isFinalAttempt) {
        console.error(
          `[webhook:${provider}] Event ${eventId} moved to dead_letter after ${maxRetries} attempts: ${errorMessage}`,
        );
        return;
      }

      // Exponential backoff: 1s, 4s
      const delayMs = attempt ** 2 * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
