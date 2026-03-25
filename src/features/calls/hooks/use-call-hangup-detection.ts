'use client';

import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

interface UseCallHangupDetectionOptions {
  callId: string | null;
  isActive: boolean;
  onHangup: (durationSeconds: number) => void;
}

/**
 * Listens for Supabase Realtime UPDATE on a specific `calls` row.
 * When the webhook updates `duration_seconds` (hangup from provider),
 * this hook fires `onHangup` so the UI can transition to the ended state.
 */
export function useCallHangupDetection({
  callId,
  isActive,
  onHangup,
}: UseCallHangupDetectionOptions) {
  const onHangupRef = useRef(onHangup);
  useEffect(() => {
    onHangupRef.current = onHangup;
  }, [onHangup]);

  useEffect(() => {
    if (!callId || !isActive) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`call-hangup-${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${callId}`,
        },
        (payload) => {
          const newRecord = payload.new as { duration_seconds?: number; status?: string };
          const duration = newRecord.duration_seconds ?? 0;

          // Only trigger hangup if duration was actually set by the webhook
          if (duration > 0) {
            onHangupRef.current(duration);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [callId, isActive]);
}
