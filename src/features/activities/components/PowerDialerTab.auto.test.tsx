import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/shared/components/ui/tooltip';
import { initialWebphoneState, type WebphoneState } from '@/features/integrations/webphone/webphone-state';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';
import { AUTO_DIAL_STORAGE_KEY } from '../utils/auto-dialer';

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
// Pedido do microfone no clique: usa a decisão real (`resolveMicForDial`) sobre
// o store falso e um `getUserMedia` controlado pelo teste.
const mic = vi.hoisted(() => ({ request: vi.fn(), resume: vi.fn() }));
vi.mock('@/features/integrations/webphone/webphone-client', async () => {
  const { resolveMicForDial, webphoneMicNeedsGesture } = await vi.importActual<
    typeof import('@/features/integrations/webphone/webphone-state')
  >('@/features/integrations/webphone/webphone-state');
  return {
    getWebphoneState: () => phone.get(),
    hangupCall: () => actions.localHangup(),
    prepareWebphoneMicForDial: () => {
      mic.resume();
      const state = phone.get() as WebphoneState;
      if (!webphoneMicNeedsGesture(state)) return null;
      return resolveMicForDial(state, mic.request);
    },
  };
});
vi.mock('@/features/integrations/webphone/useApi4ComWebphone', () => ({
  useApi4ComWebphone: () => useSyncExternalStore(phone.subscribe, phone.get, phone.get),
}));

// --- sinal da API4COM controlado pelo teste ---------------------------------
const answer = vi.hoisted(() => ({ value: 'unknown' as 'unknown' | 'answered' | 'not_answered' }));
vi.mock('@/features/integrations/webphone/useWebphoneLeadAnswer', () => ({
  useWebphoneLeadAnswer: (callId: string | null) => (callId ? answer.value : 'unknown'),
}));

// --- ações do servidor -------------------------------------------------------
const actions = vi.hoisted(() => ({
  initiateCall: vi.fn(),
  hangupCall: vi.fn(),
  localHangup: vi.fn(),
  completeDialerCall: vi.fn(),
}));
vi.mock('@/features/calls/actions/initiate-call', () => ({ initiateCall: actions.initiateCall, hangupCall: actions.hangupCall }));
vi.mock('../actions/complete-dialer-call', () => ({ completeDialerCall: actions.completeDialerCall }));
const leadCard = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../actions/fetch-dialer-lead-card', () => ({ fetchDialerLeadCard: leadCard.fetch }));
const providerHangup = vi.hoisted(() => ({
  fire: null as null | ((durationSeconds: number) => void),
}));
vi.mock('@/features/calls/hooks/use-call-hangup-detection', () => ({
  useCallHangupDetection: (opts: { isActive: boolean; onHangup: (durationSeconds: number) => void }) => {
    providerHangup.fire = opts.isActive ? opts.onHangup : null;
  },
}));
vi.mock('@/features/auth/hooks/useOrganization', () => ({
  useOrganization: () => ({ isManager: true, organization: {}, currentMember: {}, members: [], loading: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { clearWebphoneCallContext, setWebphoneCallNotes } from '@/features/integrations/webphone/webphone-call-context';
import { claimWebphoneDial, resetWebphoneDialCorrelation } from '@/features/integrations/webphone/webphone-dial-correlation';
import { LOCAL_SESSION_GRACE_MS, RAMAL_RELEASE_WINDOW_MS, SESSION_MISSING_MESSAGE } from '../utils/power-dialer-webphone-sync';

import { PowerDialerTab } from './PowerDialerTab';

function lead(id: string, name: string, over: Partial<DialerQueueItem> = {}): DialerQueueItem {
  return {
    enrollmentId: `e-${id}`,
    leadId: `l-${id}`,
    leadName: name,
    firstName: null,
    lastName: null,
    companyName: name,
    phone: `(11) 9000${id}-0000`,
    phones: [],
    cadenceName: 'Cadência',
    cadenceId: 'c1',
    stepId: `s-${id}`,
    stepOrder: 2,
    totalSteps: 5,
    nextStepDue: '2026-10-22T10:00:00Z',
    activityName: null,
    callScript: null,
    currentStepIsPhone: true,
    phoneAttempts: [],
    ...over,
  };
}

const ready: WebphoneState = { ...initialWebphoneState, registration: 'registered', mic: 'granted' };
let dialSeq = 0;

function renderDialer(queue: DialerQueueItem[], leadCardEnabled = false) {
  return render(
    <TooltipProvider>
      <PowerDialerTab
        initialQueue={queue}
        stats={{ leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: queue.length }}
        preferences={{ simultaneous_phones: 2, daily_limit_per_lead: 3 }}
        leadCardEnabled={leadCardEnabled}
      />
    </TooltipProvider>,
  );
}

/** Avança o relógio em passos de até 1 s, deixando o React rodar os efeitos entre eles. */
async function advance(ms: number) {
  let left = ms;
  while (left > 0) {
    const step = Math.min(1000, left);
    left -= step;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
  }
}

function attachThisSession(phoneNumber: string, phase: 'in-call' | 'ended' | 'ringing' = 'in-call') {
  const token = claimWebphoneDial(phoneNumber, true);
  const current = phone.get() as WebphoneState;
  phone.set({
    ...ready,
    call: {
      id: `wp-${dialSeq}`,
      remoteNumber: phoneNumber.replace(/\D/g, ''),
      direction: 'incoming',
      integrated: true,
      dialToken: token,
      phase,
      startedAt: current.call?.startedAt ?? Date.now(),
      answeredAt: phase === 'ringing' ? null : Date.now(),
      endedAt: phase === 'ended' ? Date.now() : null,
      endCause: phase === 'ended' ? 'Terminated' : null,
      muted: false,
      audioStats: null,
    },
  });
  return token;
}

/** A ligação integrada desta discagem acabou no navegador. */
async function endBrowserCall() {
  await act(async () => {
    const current = phone.get() as WebphoneState;
    if (!current.call) return;
    phone.set({
      ...current,
      call: { ...current.call, phase: 'ended', endedAt: Date.now(), endCause: 'Terminated' },
    });
  });
}

describe('PowerDialerTab — discagem automática', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    window.localStorage.setItem(AUTO_DIAL_STORAGE_KEY, '1');
    resetWebphoneDialCorrelation();
    clearWebphoneCallContext();
    phone.set(ready);
    answer.value = 'unknown';
    dialSeq = 0;
    actions.localHangup.mockReset();
    actions.hangupCall.mockReset().mockResolvedValue({ success: true });
    actions.initiateCall.mockReset().mockImplementation(async (input: { phone: string }) => {
      dialSeq += 1;
      attachThisSession(input.phone);
      return { success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } };
    });
    actions.completeDialerCall.mockReset().mockResolvedValue({ success: true, data: { callId: 'x' } });
    leadCard.fetch.mockReset().mockResolvedValue({ success: false, error: 'nao usado' });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('não atendeu com tentativas no dia → NÃO conclui a tarefa e liga o próximo lead', async () => {
    renderDialer([lead('1', 'Maria Silva'), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));

    expect(screen.getByText(/Próxima ligação em 5 s — Maria Silva/)).toBeInTheDocument();
    expect(screen.getByText(/número 1 de 1 · tentativa 1\/3/)).toBeInTheDocument();
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.initiateCall).toHaveBeenCalledWith(expect.objectContaining({ phone: '(11) 90001-0000', leadId: 'l-1' }));

    answer.value = 'not_answered';
    await advance(10);
    await endBrowserCall();

    expect(actions.completeDialerCall).not.toHaveBeenCalled();
    expect(screen.getByText(/Próxima ligação em 5 s — Joao Santos/)).toBeInTheDocument();

    answer.value = 'unknown';
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
    expect(actions.initiateCall).toHaveBeenLastCalledWith(expect.objectContaining({ leadId: 'l-2' }));
  });

  it('com a flag ligada troca o cartão quando o automático passa para o próximo lead', async () => {
    leadCard.fetch.mockImplementation(async (input: { leadId: string }) => ({
      success: true,
      data: {
        attemptLabel: 'TENTATIVA 2/5',
        name: input.leadId === 'l-2' ? 'Joao Santos' : 'Maria Silva',
        company: input.leadId === 'l-2' ? 'Joao Santos' : 'Maria Silva',
        fields: [{ id: 'temperatura', label: 'Temperatura', value: 'Sem dados' }],
        opening: input.leadId === 'l-2' ? 'Abertura do Joao' : 'Abertura da Maria',
      },
    }));
    renderDialer([lead('1', 'Maria Silva'), lead('2', 'Joao Santos')], true);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('call-lead-opening').textContent).toContain('Abertura da Maria');
    expect(screen.getByTestId('call-history-collapse')).toBeTruthy();
    expect(leadCard.fetch).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'l-1' }));

    await advance(5000);
    answer.value = 'not_answered';
    await advance(10);
    await endBrowserCall();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('call-lead-opening').textContent).toContain('Abertura do Joao');
    expect(screen.queryByText('Abertura da Maria')).toBeNull();
    expect(leadCard.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ leadId: 'l-2' }));
    expect(screen.getByText(/Próxima ligação em 5 s — Joao Santos/)).toBeInTheDocument();
  });

  it('última tentativa do dia sem atender → registra "no_answer" e segue', async () => {
    const lastTry = [{ phone: '(11) 90001-0000', attemptsToday: 2, lastAttemptAt: '2026-01-01T00:00:00Z' }];
    renderDialer([lead('1', 'Maria Silva', { phoneAttempts: lastTry }), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    expect(screen.getByText(/tentativa 3\/3/)).toBeInTheDocument();
    await advance(5000);

    answer.value = 'not_answered';
    await advance(10);
    await endBrowserCall();

    expect(actions.completeDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentId: 'e-1',
        callId: '00000000-0000-4000-8000-000000000001',
        sdrOutcome: 'no_answer',
        durationSeconds: 0,
      }),
    );
    expect(screen.getByText(/Próxima ligação em 5 s — Joao Santos/)).toBeInTheDocument();
  });

  it('lead com 2 números: não atendeu no 1º → disca o 2º do mesmo lead', async () => {
    const phones = [
      { formatted: '(11) 911110000', raw: '5511911110000', label: 'a' },
      { formatted: '(11) 922220000', raw: '5511922220000', label: 'b' },
    ];
    renderDialer([lead('1', 'Maria Silva', { phone: '(11) 911110000', phones }), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenLastCalledWith(expect.objectContaining({ phone: '(11) 911110000' }));

    answer.value = 'not_answered';
    await advance(10);
    await endBrowserCall();
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
    expect(screen.getByText(/Próxima ligação em 5 s — Maria Silva/)).toBeInTheDocument();
    expect(screen.getByText(/número 2 de 2/)).toBeInTheDocument();

    answer.value = 'unknown';
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
    expect(actions.initiateCall).toHaveBeenLastCalledWith(expect.objectContaining({ phone: '(11) 922220000', leadId: 'l-1' }));
  });

  it('todos no intervalo de 1 h → aguarda e liga de novo quando libera', async () => {
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);

    answer.value = 'not_answered';
    await advance(10);
    await endBrowserCall();
    expect(screen.getByText(/Aguardando: próxima ligação liberada às/)).toBeInTheDocument();
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);

    answer.value = 'unknown';
    await act(async () => {
      phone.set(ready);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    await advance(6000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
    expect(actions.initiateCall).toHaveBeenLastCalledWith(expect.objectContaining({ leadId: 'l-1' }));
  });

  it('atendeu → conclui sozinho com a IA pendente e liga o próximo', async () => {
    renderDialer([lead('1', 'Maria Silva'), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);

    answer.value = 'answered';
    await advance(10);
    await endBrowserCall();

    expect(actions.completeDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: 'e-1', aiOutcomePending: true, sdrOutcome: undefined }),
    );
    expect(screen.getByText(/Próxima ligação em 5 s — Joao Santos/)).toBeInTheDocument();
    answer.value = 'unknown';
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
  });

  it('não disca lead fora da etapa de ligação', async () => {
    renderDialer([lead('1', 'Maria Silva', { currentStepIsPhone: false }), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));

    expect(screen.getByText(/Próxima ligação em 5 s — Joao Santos/)).toBeInTheDocument();
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'l-2' }));
  });

  it('Pausar interrompe a contagem; "Ligar agora" disca na hora', async () => {
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));

    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: /Pausar/ }));
    await advance(10_000);
    expect(actions.initiateCall).not.toHaveBeenCalled();
    expect(screen.getByText('Discagem automática pausada')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retomar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ligar agora/ }));
    await advance(10);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
  });

  it('sem webphone pronto a chave fica desabilitada e o início é manual', () => {
    phone.set(initialWebphoneState);
    renderDialer([lead('1', 'Maria Silva')]);
    expect(screen.getByRole('switch', { name: 'Discagem automática' })).toBeDisabled();
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    expect(screen.queryByText(/Próxima ligação/)).not.toBeInTheDocument();
  });

  it('modo manual: concluir com o formulário vazio usa as anotações feitas no painel', async () => {
    window.localStorage.removeItem(AUTO_DIAL_STORAGE_KEY);
    clearWebphoneCallContext();
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    fireEvent.click(screen.getByTitle('Ligar via API4COM'));
    await advance(10);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);

    act(() => setWebphoneCallNotes('pediu proposta por e-mail'));
    answer.value = 'answered';
    await endBrowserCall();
    fireEvent.click(screen.getByRole('button', { name: /Concluir atividade/ }));
    await advance(10);

    expect(actions.completeDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({ callId: '00000000-0000-4000-8000-000000000001', notes: expect.stringContaining('pediu proposta por e-mail') }),
    );
  });

  it('POST aceito sem INVITE não declara Em chamada, não conclui e não disca de novo', async () => {
    actions.initiateCall.mockImplementation(async () => {
      dialSeq += 1;
      return { success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } };
    });
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);

    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Em chamada')).not.toBeInTheDocument();
    expect(screen.queryByText('Em ligação')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mutar|Mudo/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Aguardando o webphone desta aba/).length).toBeGreaterThan(0);

    await advance(LOCAL_SESSION_GRACE_MS);
    expect(screen.getByText(new RegExp(SESSION_MISSING_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    await advance(60_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Concluir atividade/ })).not.toBeInTheDocument();
  });

  it('fim no servidor sem a sessão desta aba não conclui e não disca de novo', async () => {
    actions.initiateCall.mockImplementation(async () => {
      dialSeq += 1;
      return { success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } };
    });
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    await act(async () => {
      providerHangup.fire?.(0);
    });
    await advance(30_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
    expect(screen.queryByText('Em chamada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Concluir atividade/ })).not.toBeInTheDocument();
  });

  it('o botão Ligar desta página também espera o INVITE e o Desligar desta tentativa não inventa mudo', async () => {
    window.localStorage.removeItem(AUTO_DIAL_STORAGE_KEY);
    actions.initiateCall.mockImplementation(async () => {
      dialSeq += 1;
      return { success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } };
    });
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    fireEvent.click(screen.getByTitle('Ligar via API4COM'));
    await advance(10);

    expect(screen.queryByText('Em chamada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mutar|Mudo/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Desligar'));
    await advance(10);
    expect(actions.localHangup).not.toHaveBeenCalled();
    expect(actions.hangupCall).toHaveBeenCalledWith('api4com', 'p1');
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
  });

  it('INVITE depois do POST confirma só o token desta discagem', async () => {
    let dialed = '';
    actions.initiateCall.mockImplementation(async (input: { phone: string }) => {
      dialSeq += 1;
      dialed = input.phone;
      return { success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } };
    });
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    expect(screen.queryByText('Em chamada')).not.toBeInTheDocument();

    await act(async () => {
      phone.set({
        ...ready,
        call: {
          id: 'wp-outro',
          remoteNumber: '11900010000',
          direction: 'incoming',
          integrated: true,
          dialToken: 'dial-antigo',
          phase: 'in-call',
          startedAt: Date.now(),
          answeredAt: Date.now(),
          endedAt: null,
          endCause: null,
          muted: false,
          audioStats: null,
        },
      });
    });
    expect(screen.queryByText('Em chamada')).not.toBeInTheDocument();

    await act(async () => {
      attachThisSession(dialed);
    });
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    expect(screen.getByText('Em ligação')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mutar|Mudo/ })).not.toBeInTheDocument();
  });

  it('INVITE antes do HTTP entra em chamada e um token antigo não encerra esta discagem', async () => {
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    expect(screen.getByText('Em chamada')).toBeInTheDocument();

    const current = phone.get() as WebphoneState;
    await act(async () => {
      phone.set({
        ...current,
        call: { ...current.call!, dialToken: 'dial-antigo', phase: 'ended' },
      });
    });
    await advance(30_000);
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
  });

  it('BYE atrasado segura a rotação e o fim do servidor com a sessão no ar não disca por cima', async () => {
    renderDialer([lead('1', 'Maria Silva'), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    expect(screen.getByText('Em chamada')).toBeInTheDocument();

    await act(async () => {
      providerHangup.fire?.(12);
    });
    await advance(30_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    expect(actions.completeDialerCall).not.toHaveBeenCalled();

    answer.value = 'not_answered';
    await endBrowserCall();
    await advance(20_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
  });

  it('424 espera a folga do ramal, tenta uma vez e para sem concluir', async () => {
    actions.initiateCall.mockResolvedValue({ success: false, error: 'ramal ocupado', code: 'ramal_busy' });
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/A próxima tentativa espera a liberação/)).toBeInTheDocument();

    await advance(RAMAL_RELEASE_WINDOW_MS - 1000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/parou para não discar por cima/)).toBeInTheDocument();
    await advance(60_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
  });

  it('erro cujo resultado é desconhecido não repete o POST', async () => {
    actions.initiateCall.mockResolvedValue({ success: false, error: 'A API4COM demorou para responder.' });
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    await advance(60_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
  });

  it('exceção no POST não repete o pedido', async () => {
    actions.initiateCall.mockRejectedValue(new Error('socket hang up'));
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    await advance(30_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
  });

  it('perda do registro antes da discagem pausa e não chama a operadora', async () => {
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(2000);
    await act(async () => {
      phone.set({ ...ready, registration: 'disconnected' });
    });
    await advance(10_000);
    expect(actions.initiateCall).not.toHaveBeenCalled();
    expect(screen.getByText(/perdeu a conexão com o ramal/)).toBeInTheDocument();
  });

  it('duplo clique com o pedido em voo faz um único POST', async () => {
    window.localStorage.removeItem(AUTO_DIAL_STORAGE_KEY);
    let release: (() => void) | null = null;
    actions.initiateCall.mockImplementation(
      (input: { phone: string }) =>
        new Promise((resolve) => {
          release = () => {
            dialSeq += 1;
            attachThisSession(input.phone);
            resolve({ success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } });
          };
        }),
    );
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    const button = screen.getByTitle('Ligar via API4COM');
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      release?.();
    });
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
  });

  it('trocar de lead ou pular durante a sessão não conclui e não disca por cima', async () => {
    renderDialer([lead('1', 'Maria Silva'), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);
    fireEvent.click(screen.getByRole('button', { name: /Joao Santos/ }));
    await advance(30_000);
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
    expect(actions.localHangup).not.toHaveBeenCalled();
  });

  it('Desligar com a sessão desta aba pede o fim local e só encerra no BYE', async () => {
    window.localStorage.removeItem(AUTO_DIAL_STORAGE_KEY);
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    fireEvent.click(screen.getByTitle('Ligar via API4COM'));
    await advance(10);
    fireEvent.click(screen.getByTitle('Desligar'));
    await advance(10);
    expect(actions.localHangup).toHaveBeenCalledTimes(1);
    expect(actions.hangupCall).toHaveBeenCalledWith('api4com', 'p1');
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    await endBrowserCall();
    expect(screen.getByText(/Chamada encerrada/)).toBeInTheDocument();
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
  });
});

describe('PowerDialerTab: microfone ainda não pedido (aba recém-carregada)', () => {
  const pending: WebphoneState = { ...ready, mic: 'unknown' };

  /** O `getUserMedia` do clique responde `permission` e o store passa a refletir isso. */
  function micAnswers(permission: 'granted' | 'denied' | 'unavailable') {
    mic.request.mockImplementation(async () => {
      phone.set({ ...(phone.get() as WebphoneState), mic: permission });
      return permission;
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    window.localStorage.setItem(AUTO_DIAL_STORAGE_KEY, '1');
    resetWebphoneDialCorrelation();
    clearWebphoneCallContext();
    phone.set(pending);
    answer.value = 'unknown';
    dialSeq = 0;
    mic.request.mockReset();
    mic.resume.mockReset();
    actions.initiateCall.mockReset().mockImplementation(async (input: { phone: string }) => {
      dialSeq += 1;
      attachThisSession(input.phone);
      return { success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('a chave do automático fica disponível e Iniciar pede o microfone no clique; concedido, a discagem segue', async () => {
    micAnswers('granted');
    renderDialer([lead('1', 'Maria Silva')]);
    expect(screen.getByRole('switch', { name: 'Discagem automática' })).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByText('Iniciar ligacoes'));
    });
    expect(mic.request).toHaveBeenCalledTimes(1);
    expect(mic.resume).toHaveBeenCalled();
    expect(screen.getByText(/Próxima ligação em 5 s . Maria Silva/)).toBeInTheDocument();
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
  });

  it('negado no clique de Iniciar: não liga o automático e não chama a operadora', async () => {
    micAnswers('denied');
    renderDialer([lead('1', 'Maria Silva')]);
    await act(async () => {
      fireEvent.click(screen.getByText('Iniciar ligacoes'));
    });
    expect(mic.request).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(screen.queryByText(/Próxima ligação/)).not.toBeInTheDocument();
    expect(actions.initiateCall).not.toHaveBeenCalled();
  });

  it('modo manual: Ligar pede o microfone no clique e só disca se conceder', async () => {
    window.localStorage.removeItem(AUTO_DIAL_STORAGE_KEY);
    micAnswers('unavailable');
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    expect(mic.request).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTitle('Ligar via API4COM'));
    });
    expect(mic.request).toHaveBeenCalledTimes(1);
    expect(actions.initiateCall).not.toHaveBeenCalled();

    // Já indisponível: o Ligar não reabre o prompt (o SDR usa "Tentar de novo" no pill).
    await act(async () => {
      fireEvent.click(screen.getByTitle('Ligar via API4COM'));
    });
    expect(mic.request).toHaveBeenCalledTimes(1);
    expect(actions.initiateCall).not.toHaveBeenCalled();
  });

  it('modo manual: concedido no clique de Ligar, disca na hora', async () => {
    window.localStorage.removeItem(AUTO_DIAL_STORAGE_KEY);
    micAnswers('granted');
    renderDialer([lead('1', 'Maria Silva')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await act(async () => {
      fireEvent.click(screen.getByTitle('Ligar via API4COM'));
    });
    expect(mic.request).toHaveBeenCalledTimes(1);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
  });
});
