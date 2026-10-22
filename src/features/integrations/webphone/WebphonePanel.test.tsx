import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialWebphoneState, type WebphoneCall, type WebphoneState } from './webphone-state';

// --- store falso do webphone ------------------------------------------------
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
}));

const answer = vi.hoisted(() => ({ value: 'not_answered' as 'unknown' | 'answered' | 'not_answered' }));
vi.mock('./useWebphoneLeadAnswer', () => ({
  useWebphoneLeadAnswer: (callId: string | null) => (callId ? answer.value : 'unknown'),
}));

const actions = vi.hoisted(() => ({
  classifyWebphoneCall: vi.fn(() => Promise.resolve({ success: true, data: { callId: 'x' } })),
  saveWebphoneCallAudio: vi.fn(() => Promise.resolve({ success: true, data: { callId: 'x' } })),
  hangupCall: vi.fn(() => Promise.resolve({ success: true })),
  scheduleActivity: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('@/features/calls/actions/classify-webphone-call', () => ({ classifyWebphoneCall: actions.classifyWebphoneCall }));
vi.mock('@/features/calls/actions/save-webphone-call-audio', () => ({ saveWebphoneCallAudio: actions.saveWebphoneCallAudio }));
vi.mock('@/features/calls/actions/initiate-call', () => ({ hangupCall: actions.hangupCall }));
vi.mock('@/features/activities/actions/schedule-activity', () => ({ scheduleActivity: actions.scheduleActivity }));
vi.mock('@/features/integrations/components/ScheduleMeetingModal', () => ({ ScheduleMeetingModal: () => null }));

import {
  clearWebphoneCallContext,
  getWebphoneCallContextState,
  onWebphoneConcludeRequested,
  setWebphoneCallContext,
  setWebphoneCallNotes,
} from './webphone-call-context';
import { LATE_CONTEXT_WAIT_MS, WebphonePanel } from './WebphonePanel';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000031';
const ready: WebphoneState = { ...initialWebphoneState, registration: 'registered', mic: 'granted' };

function sipCall(phase: WebphoneCall['phase'], startedAt: number): WebphoneCall {
  return {
    id: 'wp-1',
    remoteNumber: '16982501819',
    direction: 'incoming',
    integrated: true,
    phase,
    startedAt,
    answeredAt: startedAt + 500,
    endedAt: phase === 'ended' ? startedAt + 9000 : null,
    endCause: phase === 'ended' ? 'Terminated' : null,
    muted: false,
    audioStats: null,
  };
}

function publish(ownerHandlesResult: boolean) {
  setWebphoneCallContext({
    callId: CALL_ID,
    providerCallId: 'prov-1',
    leadId: '11111111-1111-1111-1111-111111111111',
    leadName: 'Lead de Teste',
    phone: '16982501819',
    ownerHandlesResult,
  });
}

async function endCall(startedAt: number) {
  await act(async () => {
    phone.set({ ...ready, call: sipCall('ended', startedAt) });
  });
}

describe('WebphonePanel — sem tela "Ligação finalizada" e sem avaliação', () => {
  beforeEach(() => {
    clearWebphoneCallContext();
    setWebphoneCallNotes('');
    answer.value = 'not_answered';
    for (const fn of Object.values(actions)) fn.mockClear();
    phone.set(ready);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fila de atividades: ao desligar avisa o dono com as anotações e o painel some, sem estrelas', async () => {
    const started = Date.now();
    publish(true);
    const concluded = vi.fn();
    const off = onWebphoneConcludeRequested(concluded);
    render(<WebphonePanel />);

    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', started) });
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotações da ligação' }), { target: { value: 'pediu proposta' } });

    await endCall(started);

    expect(concluded).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_ID, notes: 'pediu proposta', durationSeconds: 0 }));
    expect(screen.queryByRole('textbox', { name: 'Anotações da ligação' })).not.toBeInTheDocument();
    expect(screen.queryByText(/qualidade do áudio/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    // As anotações seguem no store para o modal do dono.
    expect(getWebphoneCallContextState().notes).toBe('pediu proposta');
    off();
  });

  it('página do lead: ao desligar abre direto o resultado; concluir grava e fecha, sem estrelas', async () => {
    const started = Date.now();
    publish(false);
    setWebphoneCallNotes('retornar amanhã');
    render(<WebphonePanel />);

    await endCall(started);

    expect(screen.getByText('Resultado da Ligação')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Faça anotações sobre a ligação/)).toHaveValue('retornar amanhã');
    fireEvent.click(screen.getByRole('button', { name: /Concluir atividade/ }));

    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(
      expect.objectContaining({ callId: CALL_ID, sdrOutcome: 'no_answer', notes: 'retornar amanhã' }),
    );
    expect(screen.queryByText('Resultado da Ligação')).not.toBeInTheDocument();
    expect(screen.queryByText(/qualidade do áudio/i)).not.toBeInTheDocument();
    expect(actions.saveWebphoneCallAudio).not.toHaveBeenCalledWith(expect.objectContaining({ audioQuality: expect.anything() }));
  });

  it('contexto que chega depois do fim (até 3 s) ainda abre o resultado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const started = Date.now();
    render(<WebphonePanel />);

    await endCall(started);
    expect(screen.queryByText('Resultado da Ligação')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      publish(false);
    });

    expect(screen.getByText('Resultado da Ligação')).toBeInTheDocument();
  });

  it('sem contexto (ligação recebida): nada aparece e o painel desiste em 3 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const started = Date.now();
    setWebphoneCallNotes('rascunho');
    render(<WebphonePanel />);

    await endCall(started);
    await act(async () => {
      vi.advanceTimersByTime(LATE_CONTEXT_WAIT_MS);
    });

    expect(screen.queryByText('Resultado da Ligação')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(getWebphoneCallContextState().notes).toBe('');
  });
});
