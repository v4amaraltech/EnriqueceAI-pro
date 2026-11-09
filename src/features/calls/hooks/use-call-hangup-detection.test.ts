import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const phone = vi.hoisted(() => {
  const pending: Array<{ id: string; resolve: (row: Record<string, unknown> | null) => void }> = [];
  let currentId = '';
  let onUpdate: ((payload: { new: Record<string, unknown> }) => void) | null = null;
  const filters: string[] = [];
  const removed: string[] = [];
  return {
    pending,
    filters,
    removed,
    reset() {
      pending.length = 0;
      currentId = '';
      onUpdate = null;
      filters.length = 0;
      removed.length = 0;
    },
    emit(row: Record<string, unknown>) {
      onUpdate?.({ new: row });
    },
    client() {
      const chain = {
        select: () => chain,
        eq: (_col: string, val: string) => {
          currentId = val;
          return chain;
        },
        maybeSingle: () =>
          new Promise<{ data: Record<string, unknown> | null }>((resolve) => {
            pending.push({
              id: currentId,
              resolve: (row) => resolve({ data: row }),
            });
          }),
      };
      return {
        channel(name: string) {
          filters.push(name);
          return {
            on(_event: string, _filter: unknown, cb: (payload: { new: Record<string, unknown> }) => void) {
              onUpdate = cb;
              return this;
            },
            subscribe() {
              return this;
            },
          };
        },
        removeChannel() {
          removed.push('removed');
        },
        from: () => chain,
      };
    },
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => phone.client(),
}));

import { HANGUP_POLL_INTERVAL_MS, useCallHangupDetection } from './use-call-hangup-detection';

const CALL_A = '7fe4ba31-280e-4fd1-ae07-a7de46f1675b';
const CALL_B = '0081ddf3-0403-43f2-a64e-746ba407903f';
const ALT_PROVIDER_ID = 'be3874f6-0000-4000-8000-000000000022';

describe('useCallHangupDetection', () => {
  afterEach(() => {
    phone.reset();
    vi.useRealTimers();
  });

  it('não encerra no channel-answer e encerra no hangup seguinte, mesmo not_connected', async () => {
    const onHangup = vi.fn();
    renderHook(() => useCallHangupDetection({ callId: CALL_A, isActive: true, onHangup }));

    await act(async () => {
      phone.pending[0]?.resolve({ id: CALL_A, status: 'not_connected', hangup_cause: null, duration_seconds: 0 });
    });
    expect(onHangup).not.toHaveBeenCalled();

    act(() => {
      phone.emit({ id: CALL_A, status: 'not_connected', hangup_cause: null, duration_seconds: 0 });
    });
    expect(onHangup).not.toHaveBeenCalled();

    act(() => {
      phone.emit({ id: CALL_A, status: 'not_connected', hangup_cause: 'NUMBER_CHANGED', duration_seconds: 0 });
    });
    expect(onHangup).toHaveBeenCalledTimes(1);
    expect(onHangup).toHaveBeenCalledWith(0);
  });

  it('ligação atendida encerra com a duração da linha', async () => {
    const onHangup = vi.fn();
    renderHook(() => useCallHangupDetection({ callId: CALL_A, isActive: true, onHangup }));
    await act(async () => {
      phone.pending[0]?.resolve({
        id: CALL_A,
        status: 'not_significant',
        hangup_cause: 'NORMAL_CLEARING',
        duration_seconds: 24,
      });
    });
    expect(onHangup).toHaveBeenCalledTimes(1);
    expect(onHangup).toHaveBeenCalledWith(24);

    act(() => {
      phone.emit({ id: CALL_A, status: 'not_significant', hangup_cause: 'NORMAL_CLEARING', duration_seconds: 99 });
    });
    expect(onHangup).toHaveBeenCalledTimes(1);
  });

  it('leitura atrasada da linha certa encerra; evento de outro id não', async () => {
    vi.useFakeTimers();
    const onHangup = vi.fn();
    renderHook(() => useCallHangupDetection({ callId: CALL_A, isActive: true, onHangup }));

    act(() => {
      phone.emit({ id: ALT_PROVIDER_ID, status: 'not_connected', hangup_cause: 'NUMBER_CHANGED', duration_seconds: 0 });
    });
    expect(onHangup).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HANGUP_POLL_INTERVAL_MS);
    });
    const late = phone.pending.at(-1);
    expect(late?.id).toBe(CALL_A);
    await act(async () => {
      late?.resolve({ id: CALL_A, status: 'not_connected', hangup_cause: 'NUMBER_CHANGED', duration_seconds: 0 });
    });
    expect(onHangup).toHaveBeenCalledTimes(1);
    expect(onHangup).toHaveBeenCalledWith(0);
  });

  it('resposta da chamada anterior não encerra a chamada nova', async () => {
    const onHangup = vi.fn();
    const hook = renderHook(
      ({ callId }) => useCallHangupDetection({ callId, isActive: true, onHangup }),
      { initialProps: { callId: CALL_A } },
    );
    const stale = phone.pending[0];
    expect(stale?.id).toBe(CALL_A);

    hook.rerender({ callId: CALL_B });
    await act(async () => {
      stale?.resolve({ id: CALL_A, status: 'not_connected', hangup_cause: 'NUMBER_CHANGED', duration_seconds: 0 });
      phone.pending.find((item) => item.id === CALL_B)?.resolve({
        id: CALL_B,
        status: 'not_connected',
        hangup_cause: null,
        duration_seconds: 0,
      });
    });
    expect(onHangup).not.toHaveBeenCalled();

    act(() => {
      phone.emit({ id: CALL_A, status: 'not_connected', hangup_cause: 'NUMBER_CHANGED', duration_seconds: 0 });
    });
    expect(onHangup).not.toHaveBeenCalled();

    act(() => {
      phone.emit({ id: CALL_B, status: 'significant', hangup_cause: 'NORMAL_CLEARING', duration_seconds: 40 });
    });
    expect(onHangup).toHaveBeenCalledTimes(1);
    expect(onHangup).toHaveBeenCalledWith(40);
  });
});
