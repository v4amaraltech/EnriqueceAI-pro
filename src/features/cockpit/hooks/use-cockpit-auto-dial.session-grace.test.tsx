import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleActivity } from '@/features/activities/actions/schedule-activity';
import { useCallHangupDetection } from '@/features/calls/hooks/use-call-hangup-detection';
import { cancelWebphoneDial } from '@/features/integrations/webphone/webphone-dial-correlation';
import {
  concludeAutoDialCallAction,
  dialAutoLeadAction,
  getNextAutoDialCardAction,
} from '../actions/auto-dial';
import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import { getWebphoneState, prepareWebphoneMicForDial } from '@/features/integrations/webphone/webphone-client';
import { dialingBlockReason } from '@/features/integrations/webphone/webphone-state';

import { useCockpitAutoDial } from './use-cockpit-auto-dial';

vi.mock('../actions/auto-dial', () => ({
  getNextAutoDialCardAction: vi.fn(),
  dialAutoLeadAction: vi.fn(),
  resolveAutoDialNoAnswerAction: vi.fn(),
  // Veredito padrão: conversou (as ligações atendidas dos testes seguem para awaiting-sdr).
  classifyAutoDialAnsweredAction: vi.fn(async () => ({ success: true, data: { status: 'verdict', verdict: 'conversou', reason: 'long_enough', machine: false } })),
  confirmAutoDialOutcomeAction: vi.fn(),
  getAutoDialCarrierHangupAction: vi.fn(async () => ({ success: true, data: { status: 'none' } })),
  concludeAutoDialCallAction: vi.fn(),
}));
vi.mock('@/features/activities/actions/schedule-activity', () => ({ scheduleActivity: vi.fn() }));
vi.mock('@/features/integrations/webphone/useApi4ComWebphone', () => ({ useApi4ComWebphone: vi.fn() }));
vi.mock('@/features/integrations/webphone/useWebphoneLeadAnswer', () => ({ useWebphoneLeadAnswer: vi.fn() }));
vi.mock('@/features/integrations/webphone/webphone-client', () => ({
  getWebphoneState: vi.fn(() => ({ call: null })),
  prepareWebphoneMicForDial: vi.fn(),
  hangupCall: vi.fn(),
}));
vi.mock('@/features/integrations/webphone/webphone-state', () => ({ dialingBlockReason: vi.fn() }));
vi.mock('@/features/integrations/webphone/webphone-dial-correlation', () => ({
  reserveWebphoneDial: vi.fn(() => ({ token: 'tok', seq: 1 })),
  publishWebphoneDial: vi.fn((_seq: number, fn: () => void) => {
    fn();
    return true;
  }),
  cancelWebphoneDial: vi.fn(),
}));
vi.mock('@/features/integrations/webphone/webphone-call-context', () => ({ setWebphoneCallContext: vi.fn() }));
vi.mock('@/features/calls/hooks/use-call-hangup-detection', () => ({ useCallHangupDetection: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const cardOf = (leadId: string) =>
  ({
    context: { leadId, company: { name: `Empresa ${leadId}` }, decisionMaker: { name: 'Ana', phone: '11999990000' } },
    approach: {},
    generatedAt: '2026-11-13T15:00:00.000Z',
  }) as never;
const ok = (leadId: string) => ({ success: true as const, data: { status: 'ok' as const, card: cardOf(leadId), live: false, tier: 'cold' as const, leadCardExtras: null, queue: 'normal' as const } });
const sim = (attemptNo = 1) => ({ success: true as const, data: { status: 'simulated' as const, attemptNo } });
const dialed = { success: true as const, data: { status: 'dialed' as const, callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } };

const phone: { call: unknown } = { call: null };
let leadAnswer: 'unknown' | 'answered' | 'not_answered' = 'unknown';
const liveCall = (phase: string) => ({ integrated: true, phase, dialToken: 'tok' });

/** Um `act` por segundo: os efeitos só rodam entre os `act` (igual ao teste do PowerDialerTab). */
async function advance(ms: number) {
  let left = ms;
  do {
    const step = Math.min(left, 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step);
    });
    left -= step;
  } while (left > 0);
}
async function startIt(result: { current: ReturnType<typeof useCockpitAutoDial> }) {
  await act(async () => {
    await result.current.start();
  });
}


beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T15:00:00Z'));
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  phone.call = null;
  leadAnswer = 'unknown';
  vi.mocked(useApi4ComWebphone).mockImplementation(() => ({ call: phone.call }) as never);
  vi.mocked(useWebphoneLeadAnswer).mockImplementation(() => leadAnswer);
  vi.mocked(getWebphoneState).mockImplementation(() => ({ call: phone.call }) as never);
  vi.mocked(prepareWebphoneMicForDial).mockReturnValue(null);
  vi.mocked(dialingBlockReason).mockReturnValue(null);
  vi.mocked(getNextAutoDialCardAction).mockResolvedValue(ok('A'));
  vi.mocked(dialAutoLeadAction).mockResolvedValue(sim());
  vi.mocked(concludeAutoDialCallAction).mockResolvedValue({ success: true, data: { status: 'recorded', disposition: 'relevant_conversation' } });
});
afterEach(() => vi.useRealTimers());


async function reachAwaitingSession(result: { current: ReturnType<typeof useCockpitAutoDial> }) {
  vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
  phone.call = null;
  await startIt(result);
  await advance(5000);
  expect(result.current.state.phase).toBe('awaiting-session');
}

describe('prazo da sessão SIP no Cockpit (15 s, próprio; a constante de 2 s do Power Dialer não muda)', () => {
  it.each([1_000, 5_000, 14_000])('INVITE %i ms depois do POST: NÃO pausa e segue o fluxo normal da ligação', async (delay) => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingSession(result);
    await advance(delay);
    expect(result.current.state.phase).toBe('awaiting-session');
    expect(cancelWebphoneDial).not.toHaveBeenCalled(); // a reserva do token segue de pé enquanto espera

    phone.call = liveCall('active'); // a perna entrou
    rerender();
    await advance(0);
    expect(result.current.state.phase).toBe('in-call');
    await advance(20_000); // o timer antigo (2 s) e o novo (15 s) já passariam: nada pausa
    expect(result.current.state.phase).toBe('in-call');
    expect(cancelWebphoneDial).not.toHaveBeenCalled();
    expect(result.current.callLostLeadId).toBeNull();
  });

  it('a reserva vale até o fim do prazo: aos 14 s ainda de pé; aos 16 s sem sessão cancela a reserva e pausa', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingSession(result);
    await advance(14_000);
    expect(cancelWebphoneDial).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('awaiting-session');
    await advance(2_000);
    expect(cancelWebphoneDial).toHaveBeenCalledWith('tok');
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'blocked' });
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
  });

  it('pausa por sessão perdida: mensagem do Cockpit, lead marcado, e Retomar limpa a marca', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingSession(result);
    await advance(16_000);
    expect(result.current.state).toMatchObject({ phase: 'paused', message: expect.stringContaining('não entrou na ligação em 15 s') });
    expect(JSON.stringify(result.current.state)).not.toContain('Desligue esta tentativa');
    expect(result.current.callLostLeadId).toBe('A');
    act(() => result.current.resume());
    expect(result.current.callLostLeadId).toBeNull();
  });

  it('pausa por sessão perdida: Ligar depois agenda o retorno sem usar o callId anterior e Desqualificar tira o lead da sessão', async () => {
    vi.mocked(scheduleActivity).mockResolvedValue({ success: true, data: { id: 'sa-1' } } as never);
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingSession(result);
    await advance(16_000);
    let out: unknown;
    await act(async () => {
      out = await result.current.scheduleCallback?.({ scheduledAt: new Date('2026-11-13T16:00:00Z') });
    });
    expect(out).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'A', pauseCadenceUntilReturn: true }));
    expect(result.current.state.phase).toBe('paused'); // o motor segue parado: nada é derrubado nem gravado
    expect(concludeAutoDialCallAction).not.toHaveBeenCalled();
    act(() => result.current.concludeExternally?.('A', 'lost'));
    expect(result.current.state.phase).toBe('paused');
    expect(concludeAutoDialCallAction).not.toHaveBeenCalled();
  });

  it('a pausa que NÃO é de sessão perdida não marca lead (ex.: erro ao discar)', async () => {
    vi.mocked(dialAutoLeadAction).mockRejectedValue(new Error('rede'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
    expect(result.current.callLostLeadId).toBeNull();
  });
});

describe('hangup do servidor antes de a sessão entrar', () => {
  it('pausa, mas NÃO marca o lead como "ligação sem sessão" (ela não vai aparecer depois): painel não fica aberto', async () => {
    let onHangup: (() => void) | undefined;
    vi.mocked(useCallHangupDetection).mockImplementation(((opts: { onHangup: () => void }) => {
      onHangup = opts.onHangup;
    }) as never);
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingSession(result);
    await act(async () => onHangup?.());
    expect(result.current.state).toMatchObject({ phase: 'paused' });
    expect(result.current.callLostLeadId).toBeNull();
  });
});
