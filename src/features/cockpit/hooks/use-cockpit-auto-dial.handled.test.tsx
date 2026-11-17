import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleActivity } from '@/features/activities/actions/schedule-activity';
import { toast } from 'sonner';

import {
  concludeAutoDialCallAction,
  confirmAutoDialOutcomeAction,
  dialAutoLeadAction,
  getNextAutoDialCardAction,
  resolveAutoDialNoAnswerAction,
} from '../actions/auto-dial';
import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import { getWebphoneState, hangupCall, prepareWebphoneMicForDial } from '@/features/integrations/webphone/webphone-client';
import { dialingBlockReason } from '@/features/integrations/webphone/webphone-state';

import { useCockpitAutoDial } from './use-cockpit-auto-dial';

vi.mock('../actions/auto-dial', () => ({
  getNextAutoDialCardAction: vi.fn(),
  dialAutoLeadAction: vi.fn(),
  resolveAutoDialNoAnswerAction: vi.fn(),
  // Veredito padrão: conversou (as ligações atendidas dos testes seguem para awaiting-sdr).
  classifyAutoDialAnsweredAction: vi.fn(async () => ({ success: true, data: { status: 'verdict', verdict: 'conversou', reason: 'long_enough', machine: false } })),
  confirmAutoDialOutcomeAction: vi.fn(),
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
type Hook = { current: ReturnType<typeof useCockpitAutoDial> };
const AT = new Date('2026-11-13T16:00:00Z'); // 1 h depois do relógio simulado (15:00Z)

const scheduled = { success: true as const, data: { id: 'sa-1' } };

async function callbackNow(result: Hook) {
  let out: Awaited<ReturnType<NonNullable<Hook['current']['scheduleCallback']>>> | undefined;
  await act(async () => {
    out = await result.current.scheduleCallback?.({ scheduledAt: AT });
  });
  return out;
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


describe('lead tratado pelo painel com a ligação em andamento — ligação real', () => {
  beforeEach(() => {
    vi.mocked(scheduleActivity).mockResolvedValue(scheduled);
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValue(ok('B'));
    phone.call = liveCall('active');
  });

  it('Ligar depois com a ligação no ar: agenda o retorno, NÃO confirma desfecho, espera a ligação acabar e segue sem 2ª tentativa', async () => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');

    expect(await callbackNow(result)).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'A', channel: 'phone', pauseCadenceUntilReturn: true }));
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ phase: 'concluded-call' });
    expect(hangupCall).not.toHaveBeenCalled();
    await advance(20_000);
    expect(result.current.state).toEqual({ phase: 'concluded-call' }); // quem desliga é o SDR

    phone.call = liveCall('ended');
    rerender();
    await advance(0);
    expect(result.current.state).toMatchObject({ phase: 'countdown' }); // próximo lead, sem a tela de 3 ações
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'callback' });
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('falha ao agendar o retorno: erro devolvido e o motor fica intacto (lead não é concluído nem excluído)', async () => {
    vi.mocked(scheduleActivity).mockResolvedValue({ success: false, error: 'Sem agenda' });
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);

    expect(await callbackNow(result)).toEqual({ ok: false, error: 'Sem agenda' });
    expect(result.current.state.phase).toBe('in-call');
    phone.call = liveCall('ended');
    leadAnswer = 'not_answered';
    rerender();
    await advance(1000);
    expect(concludeAutoDialCallAction).not.toHaveBeenCalled();
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: [] });
  });

  it('Desqualificar enquanto a discagem ainda sai (dialing): a conclusão vale quando a ligação nasce e o motor só segue ao fim dela', async () => {
    let release: (v: typeof dialed) => void = () => undefined;
    vi.mocked(dialAutoLeadAction).mockImplementation(() => new Promise((resolve) => (release = resolve as typeof release)));
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('dialing');

    act(() => result.current.concludeExternally?.('A', 'lost'));
    expect(result.current.state.phase).toBe('dialing'); // a discagem já saiu: nada a derrubar
    await act(async () => release(dialed));
    expect(result.current.state).toEqual({ phase: 'concluded-call' });
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();

    phone.call = liveCall('ended');
    rerender();
    await advance(0);
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'lost' });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
  });

  it('Ligar depois enquanto discava: agenda o retorno e segue o mesmo caminho (sem usar o callId da ligação anterior)', async () => {
    let release: (v: typeof dialed) => void = () => undefined;
    vi.mocked(dialAutoLeadAction).mockImplementation(() => new Promise((resolve) => (release = resolve as typeof release)));
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('dialing');

    expect(await callbackNow(result)).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledTimes(1);
    await act(async () => release(dialed));
    expect(result.current.state).toEqual({ phase: 'concluded-call' });
    phone.call = liveCall('ended');
    rerender();
    await advance(0);
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'callback' });
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
  });

  it('ligação já terminou e o veredito ainda não veio (resolving): conclui na hora, sem gravar no_answer', async () => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    phone.call = liveCall('ended');
    rerender();
    await advance(0);
    expect(result.current.state.phase).toBe('resolving');

    act(() => result.current.concludeExternally?.('A', 'scheduled'));
    await advance(0);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'scheduled' });
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
  });
});

describe('lead tratado pelo painel — simulado: nada é gravado', () => {
  it('Ligar depois com a ligação no ar: só avisa, o motor deixa o lead e nada vai ao servidor', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValue(ok('B'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');

    expect(await callbackNow(result)).toEqual({ ok: true });
    expect(toast.info).toHaveBeenCalledWith('Simulado: nada é registrado.');
    expect(result.current.state).toEqual({ phase: 'concluded-call' });
    await advance(8000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
    for (const fn of [scheduleActivity, concludeAutoDialCallAction, confirmAutoDialOutcomeAction, resolveAutoDialNoAnswerAction]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('fora de uma ligação (contagem): Ligar depois devolve erro e nada muda', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    expect(await callbackNow(result)).toEqual({ ok: false, error: 'Nenhum lead em ligação.' });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });
});

describe('ação confirmada depois de um await (closure velha): o desfecho vai para a ligação do lead TRATADO', () => {
  it('lead B discando com o callId da ligação ANTERIOR no estado; a ação chega com a ligação já no ar: grava em call-2, nunca em call-1', async () => {
    const dialedB = { success: true as const, data: { status: 'dialed' as const, callId: 'call-2', providerCallId: 'prov-2', attemptNo: 1 } };
    vi.mocked(getNextAutoDialCardAction).mockReset();
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValue(ok('B'));
    let release: (v: typeof dialedB) => void = () => undefined;
    vi.mocked(dialAutoLeadAction).mockReset();
    vi.mocked(dialAutoLeadAction)
      .mockResolvedValueOnce(dialed)
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve as typeof release)));
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call'); // A, call-1
    phone.call = liveCall('ended');
    leadAnswer = 'not_answered';
    rerender();
    await advance(0);
    await advance(5000); // próxima contagem: B entra em dialing
    expect(result.current.state.phase).toBe('dialing');

    const stale = result.current.concludeExternally; // closure feita em dialing: o `callId` dela é o call-1
    phone.call = liveCall('active');
    leadAnswer = 'unknown';
    await act(async () => release(dialedB));
    rerender();
    expect(['in-call', 'concluded-call', 'awaiting-session']).toContain(result.current.state.phase);
    act(() => stale?.('B', 'lost')); // a ação confirmou só agora
    phone.call = liveCall('ended');
    rerender();
    await advance(0);
    const calls = vi.mocked(concludeAutoDialCallAction).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([{ callId: 'call-2', kind: 'lost' }]);
    expect(calls.some((c) => (c as { callId: string }).callId === 'call-1')).toBe(false);
  });
});
