import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyAutoDialAnsweredAction, confirmAutoDialOutcomeAction, dialAutoLeadAction, getAutoDialCarrierHangupAction, getNextAutoDialCardAction, resolveAutoDialNoAnswerAction } from '../actions/auto-dial';
import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import { prepareWebphoneMicForDial } from '@/features/integrations/webphone/webphone-client';
import { dialingBlockReason } from '@/features/integrations/webphone/webphone-state';

import { NOT_ANSWERED_NOTICE, VOICEMAIL_NOTICE, useCockpitAutoDial } from './use-cockpit-auto-dial';

vi.mock('../actions/auto-dial', () => ({
  getNextAutoDialCardAction: vi.fn(),
  dialAutoLeadAction: vi.fn(),
  resolveAutoDialNoAnswerAction: vi.fn(),
  // Veredito padrão: conversou (as ligações atendidas dos testes seguem para awaiting-sdr).
  classifyAutoDialAnsweredAction: vi.fn(async () => ({ success: true, data: { status: 'verdict', verdict: 'conversou', reason: 'long_enough', machine: false } })),
  confirmAutoDialOutcomeAction: vi.fn(),
  getAutoDialCarrierHangupAction: vi.fn(),
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

import { getWebphoneState } from '@/features/integrations/webphone/webphone-client';

const cardOf = (leadId: string) =>
  ({
    context: { leadId, company: { name: `Empresa ${leadId}` }, decisionMaker: { name: 'Ana', phone: '11999990000' } },
    approach: {},
    generatedAt: '2026-11-13T15:00:00.000Z',
  }) as never;
const ok = (leadId: string, tier: 'hot' | 'cold' = 'cold') => ({ success: true as const, data: { status: 'ok' as const, card: cardOf(leadId), live: false, tier, leadCardExtras: null, queue: 'normal' as const } });
const sim = (attemptNo = 1) => ({ success: true as const, data: { status: 'simulated' as const, attemptNo } });

/** Ligação "ao vivo" desta aba, para o modo real. */
const phone: { call: unknown } = { call: null };
let leadAnswer: 'unknown' | 'answered' | 'not_answered' = 'unknown';

/** Avança o relógio em passos de 1 s, um `act` por passo (os efeitos só rodam entre os `act`), como no teste do PowerDialerTab. */
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
  phone.call = null;
  leadAnswer = 'unknown';
  vi.mocked(useApi4ComWebphone).mockImplementation(() => ({ call: phone.call }) as never);
  vi.mocked(useWebphoneLeadAnswer).mockImplementation(() => leadAnswer);
  vi.mocked(getWebphoneState).mockImplementation(() => ({ call: phone.call }) as never);
  vi.mocked(prepareWebphoneMicForDial).mockReturnValue(null);
  vi.mocked(dialingBlockReason).mockReturnValue(null);
  vi.mocked(getNextAutoDialCardAction).mockResolvedValue(ok('A'));
  vi.mocked(dialAutoLeadAction).mockResolvedValue(sim());
  vi.mocked(resolveAutoDialNoAnswerAction).mockResolvedValue({ success: true, data: { status: 'recorded', attemptNo: 3 } });
  vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValue({ success: true, data: { confirmed: true } });
  vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue({ success: true, data: { status: 'verdict', verdict: 'conversou', reason: 'long_enough', machine: false } });
  vi.mocked(getAutoDialCarrierHangupAction).mockResolvedValue({ success: true, data: { status: 'none' } });
});
afterEach(() => vi.useRealTimers());


const liveCall = (phase: string) => ({ integrated: true, phase, dialToken: 'tok' });

/** A escuta desligou a ligação (marca auto_hangup lida pela action do cockpit). */
const hungUp = (prediction: 'voicemail' | 'no_answer' | 'number_not_exist') => ({ success: true as const, data: { status: 'auto_hangup' as const, prediction } });

/** Liga o motor real (tentativa `attemptNo`) e termina a ligação SEM resposta da operadora (`unknown`). */
async function endUnknown(attemptNo = 1) {
  vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo } });
  phone.call = liveCall('active');
  const hook = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
  await startIt(hook.result);
  await advance(5000);
  phone.call = liveCall('ended');
  hook.rerender();
  return hook;
}

describe('resolving sem resposta da operadora (timeout próprio de 45 s)', () => {
  it('escuta DESLIGOU por caixa postal (1ª tentativa): volta para a fila, nunca awaiting-sdr', async () => {
    vi.mocked(getAutoDialCarrierHangupAction).mockResolvedValue(hungUp('voicemail'));
    const { result } = await endUnknown(1);
    await advance(3000);
    expect(getAutoDialCarrierHangupAction).toHaveBeenCalledWith({ callId: 'call-1' });
    expect(['advancing', 'countdown', 'dialing']).toContain(result.current.state.phase);
    expect(result.current.notice).toBe(VOICEMAIL_NOTICE);
    await advance(60_000);
    expect(result.current.state).not.toEqual({ phase: 'awaiting-sdr', reason: 'timeout' });
  });

  it('escuta DESLIGOU por não atendeu (2ª) e por número inexistente (1ª): volta para a fila com aviso', async () => {
    vi.mocked(getAutoDialCarrierHangupAction).mockResolvedValue(hungUp('no_answer'));
    const a = await endUnknown(2);
    await advance(3000);
    expect(a.result.current.state.phase).not.toBe('awaiting-sdr');
    expect(a.result.current.notice).toBe(NOT_ANSWERED_NOTICE);
    a.unmount();

    vi.mocked(getAutoDialCarrierHangupAction).mockResolvedValue(hungUp('number_not_exist'));
    const b = await endUnknown(1);
    await advance(3000);
    expect(b.result.current.state.phase).not.toBe('awaiting-sdr');
    expect(b.result.current.notice).toBe(NOT_ANSWERED_NOTICE);
  });

  it('NÃO desligou (no_answer sem marca auto_hangup, mesmo com next_activity_confidence 0,9): termina em awaiting-sdr/timeout', async () => {
    // A action só enxerga a marca; sem ela responde `none`, e a confiança solta do metadata não decide nada.
    vi.mocked(getAutoDialCarrierHangupAction).mockResolvedValue({ success: true, data: { status: 'none' } });
    const { result } = await endUnknown(1);
    await advance(44_000);
    expect(result.current.state).toEqual({ phase: 'resolving' });
    await advance(1_500);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'timeout' });
    expect(result.current.notice).toBeNull();
  });

  it('3ª tentativa decidida pela escuta: espera o hangup_cause (pending 8 vezes) e grava no_answer; não vira complete_failed', async () => {
    vi.mocked(getAutoDialCarrierHangupAction).mockResolvedValue(hungUp('no_answer'));
    vi.mocked(resolveAutoDialNoAnswerAction).mockReset();
    for (let i = 0; i < 8; i++) vi.mocked(resolveAutoDialNoAnswerAction).mockResolvedValueOnce({ success: true, data: { status: 'pending' } });
    vi.mocked(resolveAutoDialNoAnswerAction).mockResolvedValue({ success: true, data: { status: 'recorded', attemptNo: 3 } });
    const { result } = await endUnknown(3);
    // 8 `pending` (o webhook ainda não trouxe hangup_cause) e então `recorded`: 9 chamadas, sem estourar para complete_failed.
    await advance(19_000);
    expect(resolveAutoDialNoAnswerAction).toHaveBeenCalledTimes(9);
    expect(resolveAutoDialNoAnswerAction).toHaveBeenLastCalledWith({ callId: 'call-1', notConversation: true });
    expect(result.current.state.phase).not.toBe('paused');
  });

  it('a action rejeita (rede): sem unhandled rejection, segue tentando a cada 2 s e cai no timeout de 45 s', async () => {
    vi.mocked(getAutoDialCarrierHangupAction).mockRejectedValue(new Error('Failed to fetch'));
    const { result } = await endUnknown(1);
    await advance(10_000);
    expect(vi.mocked(getAutoDialCarrierHangupAction).mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(result.current.state).toEqual({ phase: 'resolving' });
    await advance(35_500);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'timeout' });
    expect(result.current.notice).toBeNull();
  });

  it('a action falha uma vez e depois traz a marca: ainda decide como não atendida', async () => {
    vi.mocked(getAutoDialCarrierHangupAction).mockRejectedValueOnce(new Error('Failed to fetch'));
    vi.mocked(getAutoDialCarrierHangupAction).mockResolvedValue(hungUp('voicemail'));
    const { result } = await endUnknown(1);
    await advance(5000);
    expect(result.current.state.phase).not.toBe('awaiting-sdr');
    expect(result.current.notice).toBe(VOICEMAIL_NOTICE);
  });

  it('consulta em andamento quando o webhook diz "atendeu": não despacha não atendida', async () => {
    let release: (v: unknown) => void = () => undefined;
    vi.mocked(getAutoDialCarrierHangupAction).mockImplementation(() => new Promise((r) => { release = r as never; }) as never);
    const hook = await endUnknown(1);
    await advance(1000);
    leadAnswer = 'answered';
    hook.rerender();
    await advance(0);
    release(hungUp('voicemail'));
    await advance(3000);
    expect(hook.result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(hook.result.current.notice).toBeNull();
  });

  it('desmontar no meio da consulta: não despacha nada nem agenda nova consulta', async () => {
    let release: (v: unknown) => void = () => undefined;
    vi.mocked(getAutoDialCarrierHangupAction).mockImplementation(() => new Promise((r) => { release = r as never; }) as never);
    const hook = await endUnknown(1);
    await advance(1000);
    const calls = vi.mocked(getAutoDialCarrierHangupAction).mock.calls.length;
    hook.unmount();
    release(hungUp('voicemail'));
    await advance(10_000);
    expect(vi.mocked(getAutoDialCarrierHangupAction).mock.calls.length).toBe(calls);
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
  });

  it('troca de ligação no meio da consulta: o resultado da ligação anterior é descartado', async () => {
    let release: (v: unknown) => void = () => undefined;
    vi.mocked(getAutoDialCarrierHangupAction).mockImplementation(() => new Promise((r) => { release = r as never; }) as never);
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'p1', attemptNo: 1 } });
    phone.call = liveCall('active');
    const hook = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(hook.result);
    await advance(5000);
    phone.call = liveCall('ended');
    hook.rerender();
    await advance(1000);
    // A tela sai de `resolving` (ex.: o SDR parou o motor): a consulta pendente morre.
    await act(async () => {
      hook.result.current.stop();
    });
    release(hungUp('voicemail'));
    await advance(3000);
    expect(hook.result.current.notice).toBeNull();
    expect(hook.result.current.state.phase).toBe('off');
  });

  it('unknown sem escuta: ainda resolving aos 44 s e awaiting-sdr (timeout) só depois dos 45 s', async () => {
    const { result } = await endUnknown(1);
    await advance(44_000);
    expect(result.current.state).toEqual({ phase: 'resolving' });
    await advance(1_500);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'timeout' });
  });

  it('o webhook chega aos 25 s dizendo "atendeu": segue como conversa normal (awaiting-sdr answered)', async () => {
    const hook = await endUnknown(1);
    await advance(25_000);
    expect(hook.result.current.state).toEqual({ phase: 'resolving' });
    leadAnswer = 'answered';
    hook.rerender();
    await advance(0);
    expect(hook.result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    await advance(60_000);
    expect(hook.result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
  });

  it('o webhook chega aos 25 s dizendo "não atendeu": não atendida normal, nunca awaiting-sdr', async () => {
    const hook = await endUnknown(1);
    await advance(25_000);
    leadAnswer = 'not_answered';
    hook.rerender();
    await advance(3000);
    expect(hook.result.current.state.phase).not.toBe('awaiting-sdr');
    expect(hook.result.current.notice).toBe(NOT_ANSWERED_NOTICE);
  });
});
