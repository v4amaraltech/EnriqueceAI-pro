import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  onWebphoneConcludeRequested,
  setWebphoneCallContext,
  setWebphoneCallNotes,
} from './webphone-call-context';
import { WebphonePanel } from './WebphonePanel';

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

describe('WebphonePanel — "Ligação finalizada" continua, sem avaliação com estrelas', () => {
  beforeEach(() => {
    clearWebphoneCallContext();
    setWebphoneCallNotes('');
    // Atendida: é o caso em que a versão anterior pedia as estrelas.
    answer.value = 'answered';
    for (const fn of Object.values(actions)) fn.mockClear();
    phone.set(ready);
  });

  it('fila de atividades: mostra "Ligação finalizada"; Concluir avisa o dono com as anotações e o painel some, sem estrelas', async () => {
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

    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Anotações da ligação' })).toHaveValue('pediu proposta');
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(concluded).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_ID, notes: 'pediu proposta' }));
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    expect(screen.queryByText(/qualidade do áudio/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    off();
  });

  it('página do lead: Concluir abre o resultado; ao concluir o painel some, sem estrelas', async () => {
    const started = Date.now();
    publish(false);
    setWebphoneCallNotes('retornar amanhã');
    render(<WebphonePanel />);

    await endCall(started);
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(screen.getByText('Resultado da Ligação')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Faça anotações sobre a ligação/)).toHaveValue('retornar amanhã');
    fireEvent.click(screen.getByRole('radio', { name: /Conversa relevante/ }));
    fireEvent.click(screen.getByRole('button', { name: /Concluir atividade/ }));

    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(
      expect.objectContaining({ callId: CALL_ID, notes: 'retornar amanhã' }),
    );
    expect(screen.queryByText('Resultado da Ligação')).not.toBeInTheDocument();
    expect(screen.queryByText(/qualidade do áudio/i)).not.toBeInTheDocument();
    expect(actions.saveWebphoneCallAudio).not.toHaveBeenCalledWith(expect.objectContaining({ audioQuality: expect.anything() }));
  });

  it('o dono conclui pelo próprio modal com o painel em "Ligação finalizada": o painel some, sem estrelas', async () => {
    const started = Date.now();
    publish(true);
    render(<WebphonePanel />);

    await endCall(started);
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    await act(async () => {
      clearWebphoneCallContext(CALL_ID);
    });

    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    expect(screen.queryByText(/qualidade do áudio/i)).not.toBeInTheDocument();
  });
});
