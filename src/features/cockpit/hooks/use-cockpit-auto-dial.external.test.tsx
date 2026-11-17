import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const conclude = (result: { current: ReturnType<typeof useCockpitAutoDial> }, leadId: string, kind: 'scheduled' | 'lost') =>
  act(() => result.current.concludeExternally?.(leadId, kind));

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

describe('concludeExternally (Desqualificar / Agendar pelo painel) — simulado', () => {
  it('em ligação: NÃO derruba, espera terminar, segue SEM Confirmar e o lead sai da sessão', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValueOnce(ok('B'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');

    conclude(result, 'A', 'lost');
    expect(result.current.state).toEqual({ phase: 'concluded-call' });
    expect(hangupCall).not.toHaveBeenCalled();
    expect(getNextAutoDialCardAction).toHaveBeenCalledTimes(1); // ainda não seguiu: a ligação está no ar

    await advance(8000); // a ligação (fictícia) termina
    expect(result.current.state).toMatchObject({ phase: 'countdown' }); // seguiu sem o Confirmar
    expect(getNextAutoDialCardAction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(concludeAutoDialCallAction).not.toHaveBeenCalled(); // simulado: nada vai ao servidor
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('aguardando desfecho (atendeu): conclui na hora e libera o próximo, sem Confirmar', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValueOnce(ok('B'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000 + 8000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });

    conclude(result, 'A', 'scheduled');
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    await advance(0);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('lead diferente do atual: ignorado (nada muda e o outro lead NÃO é excluído)', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValueOnce(ok('C'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');
    conclude(result, 'B', 'lost');
    expect(result.current.state.phase).toBe('in-call');
    await advance(8000);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: [] });
  });

  it('duas chamadas: a segunda é ignorada (idempotente)', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000 + 8000);
    conclude(result, 'A', 'lost');
    const after = result.current.state;
    conclude(result, 'A', 'lost');
    conclude(result, 'A', 'scheduled');
    expect(result.current.state).toEqual(after);
    expect(getNextAutoDialCardAction).toHaveBeenCalledTimes(1 + 1);
  });

  it('fora de uma ligação (desligado, contagem, pausado): ignorada', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    conclude(result, 'A', 'lost');
    expect(result.current.state).toEqual({ phase: 'off' });
    await startIt(result);
    conclude(result, 'A', 'lost');
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    act(() => result.current.pause());
    conclude(result, 'A', 'lost');
    expect(result.current.state.phase).toBe('paused');
  });

  it('clique atrasado em Confirmar depois de concluído pelo painel não grava nada', async () => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    phone.call = liveCall('active');
    await startIt(result);
    await advance(5000);
    conclude(result, 'A', 'scheduled');
    phone.call = liveCall('ended');
    rerender();
    await advance(2000); // a ligação termina e o motor já seguiu para o próximo lead
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    let done = false;
    await act(async () => {
      done = await result.current.confirmOutcome({ disposition: 'no_answer' });
    });
    expect(done).toBe(true);
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
  });
});

describe('concludeExternally — ligação real (discagem mockada)', () => {
  it('em ligação: só grava o desfecho quando a ligação TERMINA; a ligação não é derrubada', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');

    conclude(result, 'A', 'scheduled');
    expect(result.current.state).toEqual({ phase: 'concluded-call' });
    await advance(30_000);
    expect(result.current.state).toEqual({ phase: 'concluded-call' }); // a ligação continua no ar: o motor espera
    expect(concludeAutoDialCallAction).not.toHaveBeenCalled();
    expect(hangupCall).not.toHaveBeenCalled();

    phone.call = liveCall('ended'); // o SDR desligou pelo botão Desligar
    rerender();
    await advance(0);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(concludeAutoDialCallAction).toHaveBeenCalledTimes(1);
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'scheduled' });
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('depois do fim da ligação: grava na hora e segue', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    phone.call = liveCall('ended');
    leadAnswer = 'answered';
    rerender();
    await advance(0);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    conclude(result, 'A', 'lost');
    await advance(0);
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'lost' });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });

  it('a operadora ainda não informou (pending): tenta de novo e grava; duas chamadas gravam UMA vez', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    vi.mocked(concludeAutoDialCallAction)
      .mockResolvedValueOnce({ success: true, data: { status: 'pending' } })
      .mockResolvedValueOnce({ success: true, data: { status: 'recorded', disposition: 'answered_no_progress' } });
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    phone.call = liveCall('ended');
    rerender();
    await advance(0);
    conclude(result, 'A', 'lost');
    conclude(result, 'A', 'lost');
    await advance(3000);
    expect(concludeAutoDialCallAction).toHaveBeenCalledTimes(2); // 1 pending + 1 recorded, sem duplicar a conclusão
  });

  it('Parar durante a ligação concluída volta a Desligado e AINDA grava o desfecho, sem derrubar', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    phone.call = liveCall('active');
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    conclude(result, 'A', 'lost');
    act(() => result.current.stop());
    await advance(0);
    expect(result.current.state).toEqual({ phase: 'off' });
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'lost' });
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('erro ao gravar o desfecho não trava o motor', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    vi.mocked(concludeAutoDialCallAction).mockRejectedValue(new Error('rede'));
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    conclude(result, 'A', 'scheduled');
    phone.call = liveCall('ended');
    rerender();
    await advance(0);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });
});
