'use client';

import { useEffect, useState } from 'react';

import { getWebphoneCallOutcome } from '@/features/calls/actions/get-webphone-call-outcome';

import { LEAD_ANSWER_MAX_POLLS, LEAD_ANSWER_POLL_INTERVAL_MS, type LeadAnswer } from './webphone-lead-answer';

export interface WebphoneCallOutcomeView {
  leadAnswer: LeadAnswer;
  /** `calls.hangup_cause` gravado pelo webhook (null até ele chegar). */
  hangupCause: string | null;
}

interface LeadAnswerState extends WebphoneCallOutcomeView {
  callId: string | null;
}

const UNKNOWN_OUTCOME: WebphoneCallOutcomeView = { leadAnswer: 'unknown', hangupCause: null };
const UNKNOWN: LeadAnswerState = { callId: null, ...UNKNOWN_OUTCOME };

/**
 * Acompanha, pela linha de `calls`, se o LEAD atendeu a ligação `callId`.
 * Consulta o servidor a cada 3 s enquanto o webhook da API4COM não gravou nem
 * `answered_at` nem `hangup_cause`; para na primeira resposta definitiva.
 */
export function useWebphoneLeadAnswer(callId: string | null): LeadAnswer {
  return useWebphoneCallOutcome(callId).leadAnswer;
}

/** Igual a `useWebphoneLeadAnswer`, mas também devolve a causa do fim da ligação. */
export function useWebphoneCallOutcome(callId: string | null): WebphoneCallOutcomeView {
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
        setState({ callId, leadAnswer: result.data.leadAnswer, hangupCause: result.data.hangupCause });
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

  if (!callId || state.callId !== callId) return UNKNOWN_OUTCOME;
  return state;
}
