import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialWebphoneState, type WebphoneState } from './webphone-state';

const phone = vi.hoisted(() => {
  let state: unknown = null;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: unknown) {
      state = next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});
vi.mock('./useApi4ComWebphone', () => ({
  useApi4ComWebphone: () => useSyncExternalStore(phone.subscribe, phone.get, phone.get),
}));
vi.mock('./webphone-client', () => ({
  answerCall: vi.fn(),
  hangupCall: vi.fn(() => Promise.resolve()),
  toggleMute: vi.fn(),
  getWebphoneState: () => phone.get(),
  requestWebphoneMicrophone: vi.fn(() => Promise.resolve('granted')),
  takeOverWebphone: vi.fn(() => Promise.resolve()),
  reconnectWebphone: vi.fn(() => Promise.resolve()),
}));

const outcome = vi.hoisted(() => ({
  calls: [] as string[],
  hangup: false,
  pending: null as Promise<void> | null,
  release: () => {},
}));
vi.mock('@/features/calls/actions/get-webphone-call-outcome', () => ({
  getWebphoneCallOutcome: vi.fn(async ({ callId }: { callId: string }) => {
    outcome.calls.push(callId);
    if (callId === '559d0ad0-0000-4000-8000-0000000000a1' && outcome.pending) await outcome.pending;
    if (!outcome.hangup) {
      return { success: true, data: { leadAnswer: 'unknown', hangupCause: null, durationSeconds: 0 } };
    }
    return { success: true, data: { leadAnswer: 'answered', hangupCause: 'NORMAL_CLEARING', durationSeconds: 28 } };
  }),
}));
vi.mock('@/features/calls/actions/classify-webphone-call', () => ({
  classifyWebphoneCall: vi.fn(() => Promise.resolve({ success: true, data: { callId: 'x' } })),
}));
vi.mock('@/features/calls/actions/save-webphone-call-audio', () => ({
  saveWebphoneCallAudio: vi.fn(() => Promise.resolve({ success: true })),
}));
const hangup = vi.hoisted(() => vi.fn(() => Promise.resolve({ success: true })));
vi.mock('@/features/calls/actions/initiate-call', () => ({ hangupCall: hangup }));
vi.mock('@/features/activities/actions/schedule-activity', () => ({
  scheduleActivity: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('@/features/calls/use-post-call-suggestion', () => ({
  usePostCallSuggestion: () => ({
    outcome: null,
    nextActivity: null,
    reason: null,
    source: null,
    alreadyFilled: false,
    alreadyFilledDisposition: null,
    meetingPrefill: null,
  }),
}));

vi.mock('@/features/integrations/components/ScheduleMeetingModal', () => ({ ScheduleMeetingModal: () => null }));

import { resetWebphoneCallContextForTests, setWebphoneCallContext } from './webphone-call-context';
import { WebphonePanel } from './WebphonePanel';

const CALL_A = '559d0ad0-0000-4000-8000-0000000000a1';
const CALL_B = 'adb23762-4673-4663-a9ed-5d1855f4f04d';
const ready: WebphoneState = { ...initialWebphoneState, registration: 'registered', mic: 'granted' };

function publish(callId: string, token: string, phoneNumber = '11954958486') {
  setWebphoneCallContext({
    callId,
    providerCallId: token,
    dialToken: token,
    leadId: '969ea854-1724-4f22-85a3-3633cd314553',
    leadName: callId === CALL_A ? null : 'Mercante Net',
    phone: phoneNumber,
    ownerHandlesResult: false,
  });
}

describe('WebphonePanel acompanha a ligação no servidor além de 2 min', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    outcome.calls = [];
    outcome.hangup = false;
    outcome.pending = null;
    resetWebphoneCallContextForTests();
    phone.set(ready);
    hangup.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passa de 40 consultas, confirma o fim só com hangup e para em seguida', async () => {
    render(<WebphonePanel />);
    await act(async () => {
      publish(CALL_B, 'prov-b');
    });
    expect(screen.getByText('Chamando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mutar' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Desligar' }));
    expect(hangup).toHaveBeenCalledWith('api4com', 'prov-b');
    expect(screen.getByText('Chamando…')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(outcome.calls.length).toBeGreaterThan(40);
    expect(outcome.calls.every((id) => id === CALL_B)).toBe(true);
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();

    outcome.hangup = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByText('00:28')).toBeInTheDocument();
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    const settled = outcome.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(outcome.calls.length).toBe(settled);
  });

  it('resposta tardia de A não encerra B', async () => {
    let release: () => void = () => {};
    outcome.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<WebphonePanel />);
    await act(async () => {
      publish(CALL_A, 'prov-a', '1151350071');
    });
    await act(async () => {
      publish(CALL_B, 'prov-b', '11954958486');
      await vi.advanceTimersByTimeAsync(3_000);
    });
    outcome.hangup = true;
    release();
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    expect(screen.queryByText('1151350071')).not.toBeInTheDocument();
  });
});
