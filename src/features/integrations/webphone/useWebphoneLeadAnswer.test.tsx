import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchOutcome = vi.hoisted(() => vi.fn());
vi.mock('@/features/calls/fetch-webphone-call-outcome', () => ({ fetchWebphoneCallOutcome: fetchOutcome }));

import { useWebphoneCallOutcome } from './useWebphoneLeadAnswer';
import { LEAD_ANSWER_MAX_POLLS, LEAD_ANSWER_POLL_INTERVAL_MS } from './webphone-lead-answer';

const unknown = { success: true, data: { leadAnswer: 'unknown', hangupCause: null, durationSeconds: 0 } };

async function advance(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - t));
    });
  }
}

describe('useWebphoneCallOutcome — sinal de consultas esgotadas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchOutcome.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('desconhecido o tempo todo: ao fim das consultas marca exhausted e continua unknown', async () => {
    fetchOutcome.mockResolvedValue(unknown);
    const { result } = renderHook(() => useWebphoneCallOutcome('call-1'));
    await advance(LEAD_ANSWER_POLL_INTERVAL_MS * (LEAD_ANSWER_MAX_POLLS + 1));

    expect(fetchOutcome).toHaveBeenCalledTimes(LEAD_ANSWER_MAX_POLLS);
    expect(result.current.leadAnswer).toBe('unknown');
    expect(result.current.exhausted).toBe(true);
  });

  it('antes do teto: exhausted ainda não está marcado', async () => {
    fetchOutcome.mockResolvedValue(unknown);
    const { result } = renderHook(() => useWebphoneCallOutcome('call-1'));
    await advance(LEAD_ANSWER_POLL_INTERVAL_MS * 5);

    expect(result.current.exhausted).not.toBe(true);
  });

  it('resposta definitiva: não marca exhausted', async () => {
    fetchOutcome.mockResolvedValue({ success: true, data: { leadAnswer: 'not_answered', hangupCause: 'X', durationSeconds: 0 } });
    const { result } = renderHook(() => useWebphoneCallOutcome('call-1'));
    await advance(LEAD_ANSWER_POLL_INTERVAL_MS * (LEAD_ANSWER_MAX_POLLS + 1));

    expect(result.current.leadAnswer).toBe('not_answered');
    expect(result.current.exhausted).not.toBe(true);
  });

  it('consulta que falha o tempo todo também esgota, sem quebrar', async () => {
    fetchOutcome.mockResolvedValue(null);
    const { result } = renderHook(() => useWebphoneCallOutcome('call-1'));
    await advance(LEAD_ANSWER_POLL_INTERVAL_MS * (LEAD_ANSWER_MAX_POLLS + 1));

    expect(result.current.leadAnswer).toBe('unknown');
    expect(result.current.exhausted).toBe(true);
  });
});
