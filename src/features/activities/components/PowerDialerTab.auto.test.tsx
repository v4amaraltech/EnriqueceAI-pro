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
vi.mock('@/features/integrations/webphone/webphone-client', () => ({ getWebphoneState: () => phone.get() }));
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
  completeDialerCall: vi.fn(),
}));
vi.mock('@/features/calls/actions/initiate-call', () => ({ initiateCall: actions.initiateCall, hangupCall: actions.hangupCall }));
vi.mock('../actions/complete-dialer-call', () => ({ completeDialerCall: actions.completeDialerCall }));
vi.mock('@/features/calls/hooks/use-call-hangup-detection', () => ({ useCallHangupDetection: () => {} }));
vi.mock('@/features/auth/hooks/useOrganization', () => ({
  useOrganization: () => ({ isManager: true, organization: {}, currentMember: {}, members: [], loading: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { clearWebphoneCallContext, setWebphoneCallNotes } from '@/features/integrations/webphone/webphone-call-context';

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
    ...over,
  };
}

const ready: WebphoneState = { ...initialWebphoneState, registration: 'registered', mic: 'granted' };
let dialSeq = 0;

function renderDialer(queue: DialerQueueItem[]) {
  return render(
    <TooltipProvider>
      <PowerDialerTab
        initialQueue={queue}
        stats={{ leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: queue.length }}
        preferences={{ simultaneous_phones: 2, daily_limit_per_lead: 3 }}
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

/** A ligação integrada desta discagem acabou no navegador. */
async function endBrowserCall() {
  await act(async () => {
    phone.set({
      ...ready,
      call: {
        id: `wp-${dialSeq}`,
        remoteNumber: '',
        direction: 'incoming',
        integrated: true,
        phase: 'ended',
        startedAt: Date.now(),
        answeredAt: Date.now(),
        endedAt: Date.now(),
        endCause: 'Terminated',
        muted: false,
        audioStats: null,
      },
    });
  });
}

describe('PowerDialerTab — discagem automática', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    window.localStorage.setItem(AUTO_DIAL_STORAGE_KEY, '1');
    phone.set(ready);
    answer.value = 'unknown';
    dialSeq = 0;
    actions.initiateCall.mockReset().mockImplementation(async () => {
      dialSeq += 1;
      return { success: true, data: { callId: `00000000-0000-4000-8000-00000000000${dialSeq}`, providerCallId: `p${dialSeq}` } };
    });
    actions.completeDialerCall.mockReset().mockResolvedValue({ success: true, data: { callId: 'x' } });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('não atendeu → registra "no_answer" na mesma ligação e liga o próximo depois de 5 s', async () => {
    renderDialer([lead('1', 'Maria Silva'), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));

    expect(screen.getByText(/Próxima ligação em 5 s — Maria Silva/)).toBeInTheDocument();
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
    expect(actions.initiateCall).toHaveBeenCalledWith(expect.objectContaining({ phone: '(11) 90001-0000', leadId: 'l-1' }));

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

    answer.value = 'unknown';
    await advance(5000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(2);
    expect(actions.initiateCall).toHaveBeenLastCalledWith(expect.objectContaining({ leadId: 'l-2' }));
  });

  it('atendeu → para e espera o SDR concluir', async () => {
    renderDialer([lead('1', 'Maria Silva'), lead('2', 'Joao Santos')]);
    fireEvent.click(screen.getByText('Iniciar ligacoes'));
    await advance(5000);

    answer.value = 'answered';
    await advance(10);
    await endBrowserCall();

    expect(screen.getByText('O lead atendeu — conclua para seguir')).toBeInTheDocument();
    expect(actions.completeDialerCall).not.toHaveBeenCalled();
    await advance(10_000);
    expect(actions.initiateCall).toHaveBeenCalledTimes(1);
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
});
