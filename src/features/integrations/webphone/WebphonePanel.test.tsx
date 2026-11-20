import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetCallResultModalExclusive } from '@/features/activities/components/call-result-modal-exclusive';

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
  hangupCall: () => carrier.hangupLeg(),
  toggleMute: vi.fn(),
  sendDtmf: vi.fn(() => {
    carrier.dtmfUsed = true;
    return 'RFC2833';
  }),
  shouldAutoHangupOnCarrier: () => !carrier.dtmfUsed,
  getRemoteAudioTrack: () => ({ kind: 'audio' }),
  subscribeRemoteAudioTrack: () => () => undefined,
  getWebphoneState: () => phone.get(),
  requestWebphoneMicrophone: client.requestWebphoneMicrophone,
  takeOverWebphone: client.takeOverWebphone,
  reconnectWebphone: client.reconnectWebphone,
  stopWebphone: client.stopWebphone,
}));
const carrier = vi.hoisted(() => ({
  dtmfUsed: false,
  onCarrierHangup: null as null | (() => void),
  hangupLeg: vi.fn(() => Promise.resolve()),
}));
vi.mock('./live-amd-browser', () => ({
  startLiveAmdBrowser: (opts: { onCarrierHangup: () => void }) => {
    carrier.onCarrierHangup = opts.onCarrierHangup;
    return () => undefined;
  },
}));
const client = vi.hoisted(() => ({
  requestWebphoneMicrophone: vi.fn(() => Promise.resolve('granted')),
  takeOverWebphone: vi.fn(() => Promise.resolve()),
  reconnectWebphone: vi.fn(() => Promise.resolve()),
  stopWebphone: vi.fn(),
}));

const answer = vi.hoisted(() => ({
  value: 'not_answered' as 'unknown' | 'answered' | 'not_answered',
  hangupCause: null as string | null,
  durationSeconds: 0,
  exhausted: false,
  /** Se definido, o hangup só existe para ESTE id (como no servidor: cada ligação tem o seu). */
  hangupOnlyFor: null as string | null,
  queried: [] as Array<string | null>,
}));
vi.mock('./useWebphoneLeadAnswer', () => ({
  useWebphoneLeadAnswer: (callId: string | null) => (callId ? answer.value : 'unknown'),
  useWebphoneCallOutcome: (callId: string | null) => {
    answer.queried.push(callId);
    return callId
      ? { leadAnswer: answer.value, hangupCause: answer.hangupOnlyFor && answer.hangupOnlyFor !== callId ? null : answer.hangupCause, durationSeconds: answer.durationSeconds, exhausted: answer.exhausted }
      : { leadAnswer: 'unknown', hangupCause: null, durationSeconds: 0 };
  },
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


import {
  clearWebphoneCallContext,
  onWebphoneConcludeRequested,
  requestWebphoneAutoConclude,
  resetWebphoneCallContextForTests,
  setWebphoneCallContext,
  setWebphoneCallNotes,
} from './webphone-call-context';
import { resetWebphoneDialCorrelation } from './webphone-dial-correlation';
import { WebphonePanel } from './WebphonePanel';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000031';
const ready: WebphoneState = { ...initialWebphoneState, registration: 'registered', mic: 'granted' };

function sipCall(phase: WebphoneCall['phase'], startedAt: number, dialToken: string | null = null): WebphoneCall {
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
    dialToken,
  };
}

function publish(ownerHandlesResult: boolean, hideNotes?: boolean) {
  setWebphoneCallContext({
    callId: CALL_ID,
    providerCallId: 'prov-1',
    leadId: '11111111-1111-1111-1111-111111111111',
    leadName: 'Lead de Teste',
    phone: '16982501819',
    ownerHandlesResult,
    ...(hideNotes === undefined ? {} : { hideNotes }),
    dialToken: 'token-dial',
  });
}

async function endCall(startedAt: number) {
  await act(async () => {
    phone.set({ ...ready, call: sipCall('ended', startedAt, 'token-dial') });
  });
}

describe('WebphonePanel — "Ligação finalizada" continua, sem avaliação com estrelas', () => {
  beforeEach(() => {
    resetWebphoneCallContextForTests();
    resetWebphoneDialCorrelation();
    // Atendida: é o caso em que a versão anterior pedia as estrelas.
    answer.value = 'answered';
    answer.hangupCause = 'NORMAL_CLEARING';
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

  it('página do lead: retorno cria a atividade sem afirmar que a cadência pausa', async () => {
    const started = Date.now();
    publish(false);
    render(<WebphonePanel />);

    await endCall(started);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    fireEvent.click(screen.getByRole('radio', { name: /Pediu para ligar depois/ }));
    expect(screen.queryByText(/fica pausada/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    const day = new Date().getDate();
    const today = screen.getAllByRole('button').find((button) => {
      const name = button.getAttribute('aria-label') ?? '';
      return new RegExp(`\\b${day}\\b`).test(name) && name.includes(String(new Date().getFullYear())) && !button.hasAttribute('disabled');
    });
    if (!today) throw new Error('dia de hoje não encontrado no calendário');
    fireEvent.click(today);

    expect(screen.getByText('A atividade de retorno é criada.')).toBeInTheDocument();
    expect(screen.queryByText(/fica pausada/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Concluir atividade/ }));

    expect(actions.scheduleActivity).toHaveBeenCalledTimes(1);
    expect(actions.scheduleActivity).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: '11111111-1111-1111-1111-111111111111', channel: 'phone' }),
    );
    expect(actions.scheduleActivity).toHaveBeenCalledWith(
      expect.not.objectContaining({ pauseCadenceUntilReturn: expect.anything(), completeEnrollments: expect.anything() }),
    );
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

describe('WebphonePanel — motivo quando o lead não atende', () => {
  beforeEach(() => {
    clearWebphoneCallContext();
    setWebphoneCallNotes('');
    for (const fn of Object.values(actions)) fn.mockClear();
    phone.set(ready);
  });

  it('operadora recusou: mostra "Não atendida" e o motivo em português', async () => {
    answer.value = 'not_answered';
    answer.hangupCause = 'NORMAL_TEMPORARY_FAILURE';
    publish(true);
    render(<WebphonePanel />);

    await endCall(Date.now());

    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByText('Não atendida')).toBeInTheDocument();
    expect(screen.getByTestId('webphone-hangup-reason')).toHaveTextContent('Falha na operadora. Tente de novo em instantes.');
  });

  it('webhook ainda não chegou: sem motivo na tela', async () => {
    answer.value = 'unknown';
    answer.hangupCause = null;
    publish(true);
    render(<WebphonePanel />);

    await endCall(Date.now());

    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.queryByTestId('webphone-hangup-reason')).not.toBeInTheDocument();
  });

  it('webhook ainda não chegou: mostra "Confirmando com a operadora…" e NÃO "Não atendida"', async () => {
    answer.value = 'unknown';
    answer.hangupCause = null;
    answer.exhausted = false;
    publish(true);
    render(<WebphonePanel />);

    await endCall(Date.now());

    expect(screen.getByTestId('webphone-confirming')).toHaveTextContent('Confirmando com a operadora…');
    // Linha própria (role=status), fora do slot da direita (font-mono/shrink-0) que sobrepunha o título.
    expect(screen.getByTestId('webphone-confirming')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('webphone-confirming').closest('.font-mono')).toBeNull();
    expect(screen.queryByText('Não atendida')).not.toBeInTheDocument();
  });

  it('lead atendeu: mostra a duração, sem "Confirmando" nem "Não atendida"', async () => {
    answer.value = 'answered';
    answer.hangupCause = 'NORMAL_CLEARING';
    publish(true);
    render(<WebphonePanel />);

    await endCall(Date.now());

    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByText(/00:0/)).toBeInTheDocument();
    expect(screen.queryByTestId('webphone-confirming')).not.toBeInTheDocument();
    expect(screen.queryByText('Não atendida')).not.toBeInTheDocument();
  });

  it('sem contexto da ligação: segue o ramo antigo, sem "Confirmando"', async () => {
    answer.value = 'unknown';
    answer.hangupCause = null;
    answer.exhausted = false;
    render(<WebphonePanel />);

    await endCall(Date.now());

    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.queryByTestId('webphone-confirming')).not.toBeInTheDocument();
    expect(screen.queryByTestId('webphone-unconfirmed')).not.toBeInTheDocument();
  });

  it('webhook chega depois: "Confirmando" troca para "Não atendida" + motivo', async () => {
    answer.value = 'unknown';
    answer.hangupCause = null;
    answer.exhausted = false;
    publish(true);
    const { rerender } = render(<WebphonePanel />);
    await endCall(Date.now());
    expect(screen.getByTestId('webphone-confirming')).toBeInTheDocument();

    answer.value = 'not_answered';
    answer.hangupCause = 'NORMAL_TEMPORARY_FAILURE';
    rerender(<WebphonePanel />);

    expect(screen.queryByTestId('webphone-confirming')).not.toBeInTheDocument();
    expect(screen.getByText('Não atendida')).toBeInTheDocument();
    expect(screen.getByTestId('webphone-hangup-reason')).toBeInTheDocument();
  });

  it('consultas esgotadas sem resposta: "Resultado não confirmado", nunca "Não atendida"', async () => {
    answer.value = 'unknown';
    answer.hangupCause = null;
    answer.exhausted = true;
    publish(true);
    render(<WebphonePanel />);

    await endCall(Date.now());

    expect(screen.getByTestId('webphone-unconfirmed')).toHaveTextContent('Resultado não confirmado');
    expect(screen.queryByTestId('webphone-confirming')).not.toBeInTheDocument();
    expect(screen.queryByText('Não atendida')).not.toBeInTheDocument();
    answer.exhausted = false;
  });

  it('lead atendeu: nunca mostra motivo, mesmo com causa gravada', async () => {
    answer.value = 'answered';
    answer.hangupCause = 'NORMAL_CLEARING';
    publish(true);
    render(<WebphonePanel />);

    await endCall(Date.now());

    expect(screen.queryByTestId('webphone-hangup-reason')).not.toBeInTheDocument();
  });
});

const CALL_A = '559d0ad0-0000-4000-8000-0000000000a1';
const CALL_B = 'adb23762-4673-4663-a9ed-5d1855f4f04d';

describe('WebphonePanel — ligação nova substitui o resultado pendente', () => {
  beforeEach(() => {
    resetWebphoneCallContextForTests();
    resetWebphoneDialCorrelation();
    answer.value = 'unknown';
    answer.hangupCause = null;
    answer.durationSeconds = 0;
    for (const fn of Object.values(actions)) fn.mockClear();
    actions.classifyWebphoneCall.mockImplementation(() => Promise.resolve({ success: true, data: { callId: 'x' } }));
    phone.set(ready);
  });

  async function finishA() {
    const started = Date.now() - 20_000;
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_A,
        providerCallId: 'prov-a',
        leadId: '6455684e-1111-4111-8111-111111111111',
        leadName: null,
        phone: '1151350071',
        ownerHandlesResult: false,
        dialToken: 'token-a',
        startedAt: started,
      });
      phone.set({ ...ready, call: { ...sipCall('ended', started, 'token-a'), id: 'sip-a', remoteNumber: '1151350071' } });
    });
  }

  it('mantém a finalizada de A quando a discagem nova falha e ninguém publica outro contexto', async () => {
    render(<WebphonePanel />);
    await finishA();
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByText('1151350071')).toBeInTheDocument();
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();
    expect(actions.scheduleActivity).not.toHaveBeenCalled();
  });

  it('A encerrada e B publicada: a tela segue B, sem gravar desfecho nem concluir A', async () => {
    render(<WebphonePanel />);
    await finishA();
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_B,
        providerCallId: 'prov-b',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
      });
    });

    expect(screen.getByText('Chamando…')).toBeInTheDocument();
    expect(screen.getByText('Mercante Net')).toBeInTheDocument();
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desligar' })).toBeInTheDocument();
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    expect(screen.queryByText('1151350071')).not.toBeInTheDocument();
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();
    expect(actions.scheduleActivity).not.toHaveBeenCalled();

    await act(async () => {
      phone.set({ ...ready, call: { ...sipCall('ended', Date.now() - 20_000), id: 'sip-a', remoteNumber: '1151350071' } });
    });
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    expect(screen.queryByText('1151350071')).not.toBeInTheDocument();
  });

  it('anotação pendente de A é gravada sem desfecho quando B começa', async () => {
    render(<WebphonePanel />);
    await finishA();
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotações da ligação' }), { target: { value: 'combinou retorno' } });
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_B,
        providerCallId: 'prov-b',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
      });
    });

    expect(screen.getByText('Chamando…')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Anotações da ligação' })).toHaveValue('');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Anotação gravada na ligação.')).toBeInTheDocument();
    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: CALL_A,
        clientDurationSeconds: 0,
        notes: 'combinou retorno',
        leadId: '6455684e-1111-4111-8111-111111111111',
      }),
    );
    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(expect.not.objectContaining({ sdrOutcome: expect.anything() }));
    expect(actions.scheduleActivity).not.toHaveBeenCalled();
  });

  it('sem A, o contexto de B aparece antes da sessão SIP', async () => {
    render(<WebphonePanel />);
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_B,
        providerCallId: 'prov-b',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
      });
    });
    expect(screen.getByText('Chamando…')).toBeInTheDocument();
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
  });

  it('sessão SIP de B assume timer e desligar; o fim de B não grava desfecho', async () => {
    render(<WebphonePanel />);
    await finishA();
    const started = Date.now();
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_B,
        providerCallId: 'prov-b',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
        dialToken: 'token-b',
        startedAt: started,
      });
      phone.set({ ...ready, call: { ...sipCall('in-call', started, 'token-b'), id: 'sip-b', remoteNumber: '11954958486' } });
    });
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desligar' })).toBeInTheDocument();

    await act(async () => {
      phone.set({ ...ready, call: { ...sipCall('ended', started, 'token-b'), id: 'sip-b', remoteNumber: '11954958486' } });
    });
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    expect(screen.queryByText('1151350071')).not.toBeInTheDocument();
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();
    expect(actions.scheduleActivity).not.toHaveBeenCalled();
  });

  it('webhook de B encerra a tela de B mesmo sem sessão SIP nova', async () => {
    render(<WebphonePanel />);
    await finishA();
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_B,
        providerCallId: 'prov-b',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
      });
    });
    expect(screen.getByText('Chamando…')).toBeInTheDocument();
    answer.value = 'answered';
    answer.hangupCause = 'NORMAL_CLEARING';
    answer.durationSeconds = 28;
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_B,
        providerCallId: 'prov-b',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
      });
    });
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByText('00:28')).toBeInTheDocument();
    expect(screen.queryByText('1151350071')).not.toBeInTheDocument();
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();
  });

  it('sessão SIP ainda em curso não é substituída pelo contexto seguinte', async () => {
    const started = Date.now();
    setWebphoneCallContext({
      callId: CALL_A,
      providerCallId: 'prov-a',
      leadId: '6455684e-1111-4111-8111-111111111111',
      leadName: null,
      phone: '1151350071',
      ownerHandlesResult: false,
      startedAt: started,
    });
    render(<WebphonePanel />);
    await act(async () => {
      phone.set({ ...ready, call: { ...sipCall('in-call', started), id: 'sip-a', remoteNumber: '1151350071' } });
    });
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_B,
        providerCallId: 'prov-b',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
      });
    });
    expect(screen.getByRole('button', { name: 'Desligar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mutar' })).toBeInTheDocument();
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    expect(screen.queryByText('Chamando…')).not.toBeInTheDocument();
  });

  async function finishBareA(token = 'token-a', withStats = false) {
    const started = 1_700_000_000_000;
    await act(async () => {
      phone.set({
        ...ready,
        call: {
          ...sipCall('ended', started, token),
          id: 'sip-a',
          remoteNumber: '1151350071',
          audioStats: withStats
            ? { packetsReceived: 10, packetsLost: 0, lossPercent: 0, jitterMs: null, rttMs: null, collectedAt: '2026-11-10T00:00:00.000Z' }
            : null,
        },
      });
    });
    return started + 9_000;
  }

  function publishB(startedAt: number, same: boolean) {
    setWebphoneCallContext({
      callId: CALL_B,
      providerCallId: 'prov-b',
      dialToken: 'token-b',
      leadId: same ? '6455684e-1111-4111-8111-111111111111' : '969ea854-1724-4f22-85a3-3633cd314553',
      leadName: same ? 'Lead A' : 'Mercante Net',
      phone: same ? '1151350071' : '11954958486',
      ownerHandlesResult: false,
      startedAt,
    });
  }

  it.each([
    [1_000, false],
    [30_000, false],
    [59_000, false],
    [1_000, true],
    [30_000, true],
    [59_000, true],
  ] as const)('A sem contexto e B %sms depois (mesmo destino %s) segue B', async (delta, same) => {
    render(<WebphonePanel />);
    const endedAt = await finishBareA('token-a', true);
    await act(async () => {
      publishB(endedAt + delta, same);
    });
    expect(screen.getByText('Chamando…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desligar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mutar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    expect(screen.getByText(same ? '1151350071' : '11954958486')).toBeInTheDocument();
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();
    expect(actions.saveWebphoneCallAudio).not.toHaveBeenCalled();
    expect(actions.scheduleActivity).not.toHaveBeenCalled();
  });

  it('HTTP tardio da própria A gruda no resultado e não vira chamada nova', async () => {
    render(<WebphonePanel />);
    const endedAt = await finishBareA('token-a');
    await act(async () => {
      setWebphoneCallContext({
        callId: CALL_A,
        providerCallId: 'prov-a',
        dialToken: 'token-a',
        leadId: '6455684e-1111-4111-8111-111111111111',
        leadName: null,
        phone: '1151350071',
        ownerHandlesResult: false,
        startedAt: endedAt + 1_000,
      });
    });
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.getByText('1151350071')).toBeInTheDocument();
    expect(screen.queryByText('Chamando…')).not.toBeInTheDocument();
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();
  });

  it('SIP encerrado antigo não reassume a tela de B', async () => {
    render(<WebphonePanel />);
    const endedAt = await finishBareA('token-a');
    await act(async () => {
      publishB(endedAt + 1_000, false);
    });
    await act(async () => {
      phone.set({
        ...ready,
        call: { ...sipCall('ended', 1_700_000_000_000, 'token-a'), id: 'sip-a-late', remoteNumber: '1151350071' },
      });
    });
    expect(screen.getByText('Chamando…')).toBeInTheDocument();
    expect(screen.getByText('11954958486')).toBeInTheDocument();
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
  });

  it('nota digitada em A sem callId continua editável e não é gravada em B', async () => {
    render(<WebphonePanel />);
    const endedAt = await finishBareA('token-a');
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotações da ligação' }), { target: { value: 'nota sem id' } });
    await act(async () => {
      publishB(endedAt + 1_000, false);
    });
    const pending = screen.getByRole('textbox', { name: 'Anotação sem ligação vinculada' });
    expect(pending).toHaveValue('nota sem id');
    expect(screen.getByText('Anotação sem ligação vinculada. Não foi gravada no histórico.')).toBeInTheDocument();
    fireEvent.change(pending, { target: { value: 'nota sem id, revista' } });
    expect(pending).toHaveValue('nota sem id, revista');
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();
    expect(actions.scheduleActivity).not.toHaveBeenCalled();
  });

  it('falha ao gravar a nota de A deixa o texto editável depois de B e de C', async () => {
    actions.classifyWebphoneCall.mockImplementation(() =>
      Promise.resolve({ success: false, error: 'rede' } as unknown as Awaited<ReturnType<typeof actions.classifyWebphoneCall>>),
    );
    render(<WebphonePanel />);
    await finishA();
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotações da ligação' }), { target: { value: 'nota de A' } });
    await act(async () => {
      publishB(Date.now(), false);
      await Promise.resolve();
    });
    const pending = screen.getByRole('textbox', { name: 'Anotação pendente da ligação anterior' });
    expect(pending).toHaveValue('nota de A');
    expect(screen.getByText('rede')).toBeInTheDocument();
    fireEvent.change(pending, { target: { value: 'nota de A revista' } });
    await act(async () => {
      setWebphoneCallContext({
        callId: 'cccccccc-4673-4663-a9ed-5d1855f4f04d',
        providerCallId: 'prov-c',
        dialToken: 'token-c',
        leadId: '969ea854-1724-4f22-85a3-3633cd314553',
        leadName: 'Mercante Net',
        phone: '11954958486',
        ownerHandlesResult: false,
      });
      await Promise.resolve();
    });
    expect(screen.getByRole('textbox', { name: 'Anotação pendente da ligação anterior' })).toHaveValue('nota de A revista');
    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_A, notes: 'nota de A' }));
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_B }));
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalledWith(expect.objectContaining({ sdrOutcome: expect.anything() }));
    expect(actions.scheduleActivity).not.toHaveBeenCalled();
    actions.classifyWebphoneCall.mockImplementation(() => Promise.resolve({ success: true, data: { callId: 'x' } }));
  });

  it('resposta velha da gravação não apaga a nota digitada depois', async () => {
    const pending: Array<(value: Awaited<ReturnType<typeof actions.classifyWebphoneCall>>) => void> = [];
    actions.classifyWebphoneCall.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    render(<WebphonePanel />);
    await finishA();
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotações da ligação' }), { target: { value: 'nota antiga' } });
    await act(async () => {
      publishB(Date.now(), false);
    });
    const box = screen.getByRole('textbox', { name: 'Anotação pendente da ligação anterior' });
    fireEvent.change(box, { target: { value: 'nota nova' } });
    await act(async () => {
      pending[0]?.({ success: true, data: { callId: CALL_A } });
    });
    expect(screen.getByRole('textbox', { name: 'Anotação pendente da ligação anterior' })).toHaveValue('nota nova');
    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_A, notes: 'nota antiga' }));
    expect(actions.classifyWebphoneCall).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_A, notes: 'nota nova' }));
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_B }));
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalledWith(expect.objectContaining({ sdrOutcome: expect.anything() }));
    actions.classifyWebphoneCall.mockImplementation(() => Promise.resolve({ success: true, data: { callId: 'x' } }));
  });

  it('reload recupera a nota sem id e o navegador avisa quando não consegue guardar', async () => {
    window.localStorage.setItem(
      'enriquece.webphone.pending-notes',
      JSON.stringify({
        notes: '',
        notesRev: 0,
        notesAnchor: null,
        heldNotes: [
          {
            holdId: 'h-reload',
            callId: null,
            leadId: null,
            dialToken: 'token-a',
            phone: '1151350071',
            leadName: null,
            notes: 'sobrevive ao reload',
            rev: 1,
            saveError: null,
          },
        ],
      }),
    );
    render(<WebphonePanel />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('textbox', { name: 'Anotação sem ligação vinculada' })).toHaveValue('sobrevive ao reload');
    expect(actions.classifyWebphoneCall).not.toHaveBeenCalled();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotação sem ligação vinculada' }), { target: { value: 'sobrevive ao reload!' } });
    expect(screen.getByText(/Se recarregar a página/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Anotação sem ligação vinculada' })).toHaveValue('sobrevive ao reload!');
    setItem.mockRestore();
  });
});

describe('WebphonePanel: pill do microfone e do ramal em outra aba', () => {
  beforeEach(() => {
    resetWebphoneCallContextForTests();
    resetWebphoneDialCorrelation();
    for (const fn of Object.values(client)) fn.mockClear();
  });

  it('microfone ainda não pedido (recarga): sem aviso vermelho, sem botão e sem pedir o microfone', () => {
    phone.set({ ...ready, mic: 'unknown' });
    render(<WebphonePanel />);
    expect(screen.queryByText(/microfone não ativado/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ativar microfone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Webphone' })).not.toBeInTheDocument();
    expect(client.requestWebphoneMicrophone).not.toHaveBeenCalled();
  });

  it('microfone concedido sozinho no start: pill some', () => {
    phone.set(ready);
    render(<WebphonePanel />);
    expect(screen.queryByRole('button', { name: 'Ativar microfone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Webphone' })).not.toBeInTheDocument();
  });

  it('negado: texto claro e "Tentar de novo" chama o pedido de novo', async () => {
    phone.set({ ...ready, mic: 'denied' });
    render(<WebphonePanel />);
    expect(screen.getByText(/O navegador bloqueou o microfone/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    });
    expect(client.requestWebphoneMicrophone).toHaveBeenCalledTimes(1);
    expect(client.stopWebphone).not.toHaveBeenCalled();
  });

  it('indisponível: explica o dispositivo e oferece "Tentar de novo"', () => {
    phone.set({ ...ready, mic: 'unavailable' });
    render(<WebphonePanel />);
    expect(screen.getByText(/microfone conectado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('ramal em uso em outra aba: aviso e "Usar nesta aba"', async () => {
    phone.set({ ...initialWebphoneState, mic: 'granted', sessionConflict: 'other_tab' });
    render(<WebphonePanel />);
    expect(screen.getByText(/O ramal está em uso em outra aba/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Usar nesta aba' }));
    });
    expect(client.takeOverWebphone).toHaveBeenCalledTimes(1);
    expect(client.requestWebphoneMicrophone).not.toHaveBeenCalled();
  });

  it('ramal perdido para outra instância: aviso e "Reconectar"', async () => {
    phone.set({ ...ready, registration: 'disconnected', sessionConflict: 'lost_to_other' });
    render(<WebphonePanel />);
    expect(screen.getByText(/extensão da API4COM/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reconectar' }));
    });
    expect(client.reconnectWebphone).toHaveBeenCalledTimes(1);
  });

  it('webphone desligado pelo gestor (disabled sem conflito): nada na tela', () => {
    phone.set(initialWebphoneState);
    render(<WebphonePanel />);
    expect(screen.queryByRole('region', { name: 'Webphone' })).not.toBeInTheDocument();
  });
});

beforeEach(() => {
  resetCallResultModalExclusive();
});

describe('WebphonePanel — botão Teclado (DTMF)', () => {
  beforeEach(() => {
    resetWebphoneCallContextForTests();
    resetWebphoneDialCorrelation();
  });

  it('desabilitado fora de in-call; habilitado em in-call; abre e fecha a grade', async () => {
    const t0 = Date.now();
    phone.set({ ...ready, call: { ...sipCall('ringing', t0), integrated: false, direction: 'incoming' } });
    render(<WebphonePanel />);
    expect(screen.getByTestId('webphone-keypad-toggle')).toBeDisabled();
    expect(screen.queryByTestId('webphone-keypad')).not.toBeInTheDocument();

    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', t0) });
    });
    const toggle = screen.getByTestId('webphone-keypad-toggle');
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'webphone-keypad');
    fireEvent.click(toggle);
    expect(screen.getByTestId('webphone-keypad')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Anotações da ligação' })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('webphone-keypad')).not.toBeInTheDocument();
  });

  it('fecha sozinho quando a ligação sai de in-call', async () => {
    const t0 = Date.now();
    phone.set({ ...ready, call: sipCall('in-call', t0) });
    render(<WebphonePanel />);
    fireEvent.click(screen.getByTestId('webphone-keypad-toggle'));
    expect(screen.getByTestId('webphone-keypad')).toBeInTheDocument();
    await act(async () => {
      phone.set({ ...ready, call: sipCall('ended', t0) });
    });
    expect(screen.queryByTestId('webphone-keypad')).not.toBeInTheDocument();
    expect(screen.queryByTestId('webphone-keypad-toggle')).not.toBeInTheDocument();
  });

  it('onCarrierHangup NÃO desliga depois de uma tecla enviada, e desliga se nenhuma foi', async () => {
    carrier.dtmfUsed = false;
    carrier.onCarrierHangup = null;
    carrier.hangupLeg.mockClear();
    const t0 = Date.now();
    phone.set({ ...ready, call: sipCall('in-call', t0) });
    publish(false);
    render(<WebphonePanel liveListen />);
    expect((carrier.onCarrierHangup as (() => void) | null)).not.toBeNull();
    const fireCarrierHangup = () => (carrier.onCarrierHangup as (() => void) | null)?.();

    fireCarrierHangup();
    expect(carrier.hangupLeg).toHaveBeenCalledTimes(1);

    carrier.hangupLeg.mockClear();
    fireEvent.click(screen.getByTestId('webphone-keypad-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Tecla 1' }));
    fireCarrierHangup();
    expect(carrier.hangupLeg).not.toHaveBeenCalled();
  });

  it('botão Teclado só com ícone mas com nome acessível; linha de botões pode quebrar', async () => {
    phone.set({ ...ready, call: sipCall('in-call', Date.now()) });
    render(<WebphonePanel />);
    const toggle = screen.getByRole('button', { name: 'Teclado' });
    expect(toggle.textContent).toBe('');
    expect(toggle.parentElement?.className).toContain('flex-wrap');
  });

  it('ligação que sai de in-call e volta com a mesma call.id: o teclado reabre (comportamento atual)', async () => {
    const t0 = Date.now();
    phone.set({ ...ready, call: sipCall('in-call', t0) });
    render(<WebphonePanel />);
    fireEvent.click(screen.getByTestId('webphone-keypad-toggle'));
    await act(async () => {
      phone.set({ ...ready, call: sipCall('ringing', t0) });
    });
    expect(screen.queryByTestId('webphone-keypad')).not.toBeInTheDocument();
    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', t0) });
    });
    expect(screen.getByTestId('webphone-keypad')).toBeInTheDocument();
  });
});

describe('WebphonePanel — hideNotes (o Cockpit tem o próprio campo de anotação)', () => {
  beforeEach(() => {
    resetWebphoneCallContextForTests();
    resetWebphoneDialCorrelation();
    answer.value = 'answered';
    answer.hangupCause = 'NORMAL_CLEARING';
    for (const fn of Object.values(actions)) fn.mockClear();
    phone.set(ready);
  });

  it('com hideNotes: sem campo de anotação na ligação nem na finalizada; Concluir segue existindo e avisa o dono com texto vazio', async () => {
    const started = Date.now();
    publish(true, true);
    const concluded = vi.fn();
    const off = onWebphoneConcludeRequested(concluded);
    render(<WebphonePanel />);
    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', started) });
    });
    expect(screen.queryByRole('textbox', { name: 'Anotações da ligação' })).toBeNull();
    await endCall(started);
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Anotações da ligação' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(concluded).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_ID, notes: '' }));
    off();
  });

  it('sem hideNotes (ou false): o campo aparece como sempre', async () => {
    const started = Date.now();
    publish(true);
    const { unmount } = render(<WebphonePanel />);
    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', started) });
    });
    expect(screen.getByRole('textbox', { name: 'Anotações da ligação' })).toBeInTheDocument();
    unmount();
    resetWebphoneCallContextForTests();
    publish(true, false);
    render(<WebphonePanel />);
    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', started) });
    });
    expect(screen.getByRole('textbox', { name: 'Anotações da ligação' })).toBeInTheDocument();
  });
});

describe('WebphonePanel — hangup gravado só desliga a MESMA ligação que está viva', () => {
  const ctxOf = (callId: string, startedAt: number, dialToken: string | null) => ({
    callId,
    providerCallId: `prov-${callId.slice(0, 2)}`,
    leadId: '6455684e-1111-4111-8111-111111111111',
    leadName: null,
    phone: '1151350071',
    ownerHandlesResult: false,
    startedAt,
    dialToken,
  });
  const liveCallOf = (phase: WebphoneCall['phase'], startedAt: number, dialToken: string | null, id: string) => ({
    ...sipCall(phase, startedAt, dialToken),
    id,
  });

  beforeEach(() => {
    resetWebphoneCallContextForTests();
    resetWebphoneDialCorrelation();
    answer.value = 'answered';
    answer.hangupCause = 'NORMAL_CLEARING';
    answer.durationSeconds = 30;
    answer.hangupOnlyFor = null;
    answer.queried = [];
    phone.set(ready);
    carrier.hangupLeg.mockClear();
  });

  it('chamada NOVA viva + contexto da ANTERIOR já com hangup_cause: NÃO desliga e avisa no console sem dados pessoais', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const t0 = Date.now();
      setWebphoneCallContext(ctxOf(CALL_A, t0 - 20_000, 'token-a'));
      render(<WebphonePanel />);
      await act(async () => {
        phone.set({ ...ready, call: sipCall('in-call', t0, 'token-b') });
      });
      expect(carrier.hangupLeg).not.toHaveBeenCalled();
      const call = warn.mock.calls.find((c) => String(c[0]).includes('[webphone]'));
      expect(call).toBeDefined();
      const payload = call?.[1] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(['contextCallId', 'contextStartedAt', 'hasDialToken', 'liveCallStartedAt', 'motivo']);
      expect(payload.motivo).toBe('hangup_sem_contexto_da_chamada_viva');
      expect(payload.contextCallId).toBe(CALL_A.slice(0, 8));
      expect(JSON.stringify(payload)).not.toContain('1151350071');
      // não há mais o aviso de ruído "contexto de outra ligação não casado"
      expect(warn.mock.calls.some((c) => (c[1] as { motivo?: string } | undefined)?.motivo === 'contexto_de_outra_ligacao_nao_casado')).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('caso legítimo: BYE não chegou, hangup gravado e a MESMA discagem viva (mesmo token) => desliga', async () => {
    const t0 = Date.now();
    setWebphoneCallContext(ctxOf(CALL_A, t0 - 1_000, 'token-a'));
    render(<WebphonePanel />);
    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', t0, 'token-a') });
    });
    expect(carrier.hangupLeg).toHaveBeenCalled();
  });

  it('contexto SEM token + chamada SEM token (manual/recebida) dentro da janela continua desligando', async () => {
    const t0 = Date.now();
    setWebphoneCallContext(ctxOf(CALL_A, t0 - 1_000, null));
    render(<WebphonePanel />);
    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', t0, null) });
    });
    expect(carrier.hangupLeg).toHaveBeenCalled();
  });

  it('chamada viva SEM token + contexto antigo COM token e hangup_cause: NÃO desliga e avisa hangup_sem_token_na_chamada_viva', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const t0 = Date.now();
      setWebphoneCallContext(ctxOf(CALL_A, t0 - 20_000, 'token-a'));
      render(<WebphonePanel />);
      await act(async () => {
        phone.set({ ...ready, call: sipCall('in-call', t0, null) });
      });
      expect(carrier.hangupLeg).not.toHaveBeenCalled();
      expect(warn.mock.calls.some((c) => (c[1] as { motivo?: string } | undefined)?.motivo === 'hangup_sem_token_na_chamada_viva')).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('fluxo completo: A termina (finalizada), B entra viva com o contexto de A ainda publicado e só depois chega o de B', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const t0 = Date.now();
      answer.hangupOnlyFor = CALL_A; // o servidor só tem hangup_cause da ligação A
      setWebphoneCallContext(ctxOf(CALL_A, t0, 'token-a'));
      render(<WebphonePanel />);
      await act(async () => {
        phone.set({ ...ready, call: liveCallOf('ended', t0, 'token-a', 'wp-a') });
      });
      expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
      carrier.hangupLeg.mockClear();
      answer.queried = [];

      // B entra viva; o contexto publicado ainda é o de A.
      await act(async () => {
        phone.set({ ...ready, call: liveCallOf('in-call', t0 + 5_000, 'token-b', 'wp-b') });
      });
      expect(carrier.hangupLeg).not.toHaveBeenCalled();

      // O motor publica o contexto de B: o painel passa a seguir B e consulta o resultado de B (não o de A).
      answer.queried = [];
      await act(async () => {
        setWebphoneCallContext(ctxOf(CALL_B, t0 + 5_500, 'token-b'));
      });
      expect(carrier.hangupLeg).not.toHaveBeenCalled();
      expect(answer.queried).toContain(CALL_B);

      // Quando o hangup de B for gravado e a MESMA sessão (token-b) seguir viva, aí sim desliga.
      answer.hangupOnlyFor = CALL_B;
      await act(async () => {
        phone.set({ ...ready, call: liveCallOf('in-call', t0 + 5_000, 'token-b', 'wp-b') });
        setWebphoneCallContext(ctxOf(CALL_B, t0 + 5_501, 'token-b'));
      });
      expect(carrier.hangupLeg).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('WebphonePanel — Concluir automático pedido pelo discador dono (motor, sem conversa)', () => {
  beforeEach(() => {
    resetWebphoneCallContextForTests();
    resetWebphoneDialCorrelation();
    answer.value = 'not_answered';
    answer.hangupCause = 'NORMAL_TEMPORARY_FAILURE';
    answer.durationSeconds = 0;
    answer.exhausted = false;
    for (const fn of Object.values(actions)) fn.mockClear();
    phone.set(ready);
  });

  async function inCall(started: number) {
    await act(async () => {
      phone.set({ ...ready, call: sipCall('in-call', started) });
    });
  }

  it('pedido com o cartão já finalizado: conclui UMA vez, com as anotações e a duração do clique manual', async () => {
    const started = Date.now();
    publish(true);
    const concluded = vi.fn();
    const off = onWebphoneConcludeRequested(concluded);
    render(<WebphonePanel />);
    await inCall(started);
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotações da ligação' }), { target: { value: 'caixa postal' } });
    await endCall(started);
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();

    await act(async () => {
      requestWebphoneAutoConclude(CALL_ID);
      requestWebphoneAutoConclude(CALL_ID);
    });

    expect(concluded).toHaveBeenCalledTimes(1);
    expect(concluded).toHaveBeenCalledWith({ callId: CALL_ID, durationSeconds: 0, notes: 'caixa postal' });
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    off();
  });

  it('pedido ANTES do cartão finalizar (a escuta derruba a ligação antes do fim da sessão): guarda e conclui quando finalizar', async () => {
    const started = Date.now();
    answer.hangupCause = null; // com hangup_cause já no servidor o cartão finaliza sem SIP; aqui ele só finaliza com o fim da sessão
    publish(true);
    const concluded = vi.fn();
    const off = onWebphoneConcludeRequested(concluded);
    render(<WebphonePanel />);
    await inCall(started);

    await act(async () => {
      requestWebphoneAutoConclude(CALL_ID);
    });
    expect(concluded).not.toHaveBeenCalled();

    await endCall(started);

    expect(concluded).toHaveBeenCalledTimes(1);
    expect(concluded).toHaveBeenCalledWith(expect.objectContaining({ callId: CALL_ID }));
    expect(screen.queryByText('Ligação finalizada')).not.toBeInTheDocument();
    off();
  });

  it('callId diferente: ignora, o cartão continua esperando o clique', async () => {
    const started = Date.now();
    publish(true);
    const concluded = vi.fn();
    const off = onWebphoneConcludeRequested(concluded);
    render(<WebphonePanel />);
    await inCall(started);
    await endCall(started);

    await act(async () => {
      requestWebphoneAutoConclude('outra-ligacao');
    });

    expect(concluded).not.toHaveBeenCalled();
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    off();
  });

  it('sem ownerHandlesResult (ligação fora do motor): ignora', async () => {
    const started = Date.now();
    publish(false);
    const concluded = vi.fn();
    const off = onWebphoneConcludeRequested(concluded);
    render(<WebphonePanel />);
    await inCall(started);
    await endCall(started);

    await act(async () => {
      requestWebphoneAutoConclude(CALL_ID);
    });

    expect(concluded).not.toHaveBeenCalled();
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    off();
  });

  it('sem pedido (conversa, "Confirmando…" ou sem decisão): o cartão NÃO conclui sozinho', async () => {
    const started = Date.now();
    answer.value = 'unknown';
    answer.hangupCause = null;
    publish(true);
    const concluded = vi.fn();
    const off = onWebphoneConcludeRequested(concluded);
    render(<WebphonePanel />);
    await inCall(started);
    await endCall(started);

    expect(concluded).not.toHaveBeenCalled();
    expect(screen.getByText('Ligação finalizada')).toBeInTheDocument();
    off();
  });
});
