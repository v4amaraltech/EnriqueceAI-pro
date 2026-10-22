'use client';

import { useEffect, useState } from 'react';

import { getWebphoneCallOutcome } from '@/features/calls/actions/get-webphone-call-outcome';

import { LEAD_ANSWER_MAX_POLLS, LEAD_ANSWER_POLL_INTERVAL_MS, type LeadAnswer } from './webphone-lead-answer';

interface LeadAnswerState {
  callId: string | null;
  leadAnswer: LeadAnswer;
}

const UNKNOWN: LeadAnswerState = { callId: null, leadAnswer: 'unknown' };

/**
 * Acompanha, pela linha de `calls`, se o LEAD atendeu a ligação `callId`.
 * Consulta o servidor a cada 3 s enquanto o webhook da API4COM não gravou nem
 * `answered_at` nem `hangup_cause`; para na primeira resposta definitiva.
 */
export function useWebphoneLeadAnswer(callId: string | null): LeadAnswer {
  const [state, setState] = useState<LeadAnswerState>(UNKNOWN);

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    let polls = 0;
    let timer: number | null = null;

    async function tick() {
      polls += 1;
      const result = await getWebphoneCallOutcome({ callId }).catch(() => null);
      if (cancelled) return;
      if (result?.success) {
        setState({ callId, leadAnswer: result.data.leadAnswer });
        if (result.data.leadAnswer !== 'unknown') return;
      }
      if (polls < LEAD_ANSWER_MAX_POLLS) timer = window.setTimeout(() => void tick(), LEAD_ANSWER_POLL_INTERVAL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [callId]);

  return callId && state.callId === callId ? state.leadAnswer : 'unknown';
}
