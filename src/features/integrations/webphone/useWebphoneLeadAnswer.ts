'use client';

import { useEffect, useState } from 'react';

import { getWebphoneCallOutcome } from '@/features/calls/actions/get-webphone-call-outcome';

import { LEAD_ANSWER_MAX_POLLS, LEAD_ANSWER_POLL_INTERVAL_MS, type LeadAnswer } from './webphone-lead-answer';

export interface WebphoneCallOutcomeView {
  leadAnswer: LeadAnswer;
  /** `calls.hangup_cause` gravado pelo webhook (null até ele chegar). */
  hangupCause: string | null;
  /** `calls.duration_seconds` já gravado. 0 enquanto a ligação não fechou. */
  durationSeconds: number;
}

interface LeadAnswerState extends WebphoneCallOutcomeView {
  callId: string | null;
}

const UNKNOWN_OUTCOME: WebphoneCallOutcomeView = { leadAnswer: 'unknown', hangupCause: null, durationSeconds: 0 };
const UNKNOWN: LeadAnswerState = { callId: null, ...UNKNOWN_OUTCOME };

/**
 * Acompanha, pela linha de `calls`, se o LEAD atendeu a ligação `callId`.
 * Consulta o servidor a cada 3 s enquanto o webhook da API4COM não gravou nem
 * `answered_at` nem `hangup_cause`; para na primeira resposta definitiva.
 */
export function useWebphoneLeadAnswer(callId: string | null): LeadAnswer {
  return useWebphoneCallOutcome(callId).leadAnswer;
}

/**
 * Igual a `useWebphoneLeadAnswer`, mas também devolve a causa do fim da ligação.
 * `untilHangup` continua consultando depois que o lead atende, até o webhook
 * gravar a causa. O painel usa isso quando ainda não há sessão SIP da chamada
 * nova: "atendeu" não é o fim da ligação.
 */
export function useWebphoneCallOutcome(callId: string | null, untilHangup = false): WebphoneCallOutcomeView {
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
        setState({
          callId,
          leadAnswer: result.data.leadAnswer,
          hangupCause: result.data.hangupCause,
          durationSeconds: result.data.durationSeconds,
        });
        const settled = untilHangup ? Boolean(result.data.hangupCause) : result.data.leadAnswer !== 'unknown';
        if (settled || cancelled) return;
      }
      if (cancelled) return;
      // Sem SIP o painel precisa do hangup, que pode passar de 2 min.
      // O teto antigo fica só na consulta que para no atendimento.
      // Unmount, troca de id ou hangup cancelam o próximo timeout.
      const capped = !untilHangup && polls >= LEAD_ANSWER_MAX_POLLS;
      if (!capped) timer = window.setTimeout(() => void tick(), LEAD_ANSWER_POLL_INTERVAL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [callId, untilHangup]);

  if (!callId || state.callId !== callId) return UNKNOWN_OUTCOME;
  return state;
}
