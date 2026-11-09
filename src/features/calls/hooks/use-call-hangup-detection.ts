'use client';

import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';
import { from } from '@/lib/supabase/from';

import { hangupFromCallRow, type CallHangupRow } from './call-hangup-signal';

interface UseCallHangupDetectionOptions {
  callId: string | null;
  isActive: boolean;
  onHangup: (durationSeconds: number) => void;
}

/** Leitura de segurança: o UPDATE do webhook pode chegar antes da inscrição, ou o Realtime pode não entregar. */
export const HANGUP_POLL_INTERVAL_MS = 3_000;

/**
 * Encerra a UI quando a linha desta ligação prova o fim.
 *
 * Ouve o UPDATE em `calls.id` e também lê a linha na hora e a cada poucos
 * segundos. Um evento de outro id (chamada nova, id alternativo do provedor)
 * não dispara. channel-answer não dispara.
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

    let cancelled = false;
    let fired = false;
    const supabase = createClient();

    function consider(row: CallHangupRow | null | undefined): void {
      if (cancelled || fired || !row) return;
      if (row.id && row.id !== callId) return;
      const signal = hangupFromCallRow(row);
      if (!signal) return;
      fired = true;
      onHangupRef.current(signal.durationSeconds);
    }

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
          consider(payload.new as CallHangupRow);
        },
      )
      .subscribe();

    async function read(): Promise<void> {
      try {
        const { data } = (await from(supabase, 'calls')
          .select('id, status, hangup_cause, duration_seconds')
          .eq('id', callId)
          .maybeSingle()) as { data: CallHangupRow | null };
        consider(data);
      } catch {
        // A próxima leitura tenta de novo. Um erro de rede não pode prender a tela.
      }
    }

    void read();
    const timer = window.setInterval(() => void read(), HANGUP_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [callId, isActive]);
}
