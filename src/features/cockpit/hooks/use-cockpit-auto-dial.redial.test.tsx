import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import { getWebphoneState } from '@/features/integrations/webphone/webphone-client';
import { dialingBlockReason } from '@/features/integrations/webphone/webphone-state';

import {
  classifyAutoDialAnsweredAction,
  concludeAutoDialCallAction,
  confirmAutoDialOutcomeAction,
  dialAutoLeadAction,
  getNextAutoDialCardAction,
  resolveAutoDialNoAnswerAction,
} from '../actions/auto-dial';

import {
  REDIAL_NOT_ANSWERED_MESSAGE,
  REDIAL_PREVIOUS_ALIVE_MESSAGE,
  REDIAL_SESSION_MISSING_MESSAGE,
  REDIAL_UNSURE_MESSAGE,
  useCockpitAutoDial,
} from './use-cockpit-auto-dial';

vi.mock('../actions/auto-dial', () => ({
  getNextAutoDialCardAction: vi.fn(),
  dialAutoLeadAction: vi.fn(),
  resolveAutoDialNoAnswerAction: vi.fn(),
  classifyAutoDialAnsweredAction: vi.fn(),
  confirmAutoDialOutcomeAction: vi.fn(),
  concludeAutoDialCallAction: vi.fn(async () => ({ success: true, data: { status: 'recorded', disposition: 'x' } })),
  getAutoDialCarrierHangupAction: vi.fn(async () => ({ success: true, data: { status: 'none' } })),
}));
vi.mock('@/features/integrations/webphone/useApi4ComWebphone', () => ({ useApi4ComWebphone: vi.fn() }));
vi.mock('@/features/integrations/webphone/useWebphoneLeadAnswer', () => ({ useWebphoneLeadAnswer: vi.fn() }));
vi.mock('@/features/integrations/webphone/webphone-client', () => ({ getWebphoneState: vi.fn(), prepareWebphoneMicForDial: vi.fn(() => null), hangupCall: vi.fn() }));
vi.mock('@/features/integrations/webphone/webphone-state', () => ({ dialingBlockReason: vi.fn() }));
vi.mock('@/features/integrations/webphone/webphone-dial-correlation', () => {
  let seq = 0;
  return {
    reserveWebphoneDial: vi.fn(() => ({ token: `tok-${++seq}`, seq })),
    publishWebphoneDial: vi.fn((_seq: number, fn: () => void) => {
      fn();
      return true;
    }),
    cancelWebphoneDial: vi.fn(),
  };
});
vi.mock('@/features/integrations/webphone/webphone-call-context', () => ({ setWebphoneCallContext: vi.fn(), requestWebphoneAutoConclude: vi.fn() }));
vi.mock('@/features/calls/hooks/use-call-hangup-detection', () => ({ useCallHangupDetection: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { reserveWebphoneDial } from '@/features/integrations/webphone/webphone-dial-correlation';

const cardOf = (leadId: string) =>
  ({ context: { leadId, company: { name: 'Empresa' }, decisionMaker: { name: 'Ana', phone: '11999990000' } }, approach: {}, generatedAt: '2026-11-13T15:00:00.000Z' }) as never;
const next = { success: true as const, data: { status: 'ok' as const, card: cardOf('A'), live: true, tier: 'cold' as const, leadCardExtras: null, queue: 'normal' as const } };
const dialed = (callId: string, attemptNo: number) => ({ success: true as const, data: { status: 'dialed' as const, callId, providerCallId: `p-${callId}`, attemptNo } });
const verdict = { success: true as const, data: { status: 'verdict' as const, verdict: 'conversou' as const, reason: 'long_enough' as const, machine: false } };

const phone: { call: unknown } = { call: null };
let leadAnswer: 'unknown' | 'answered' | 'not_answered' = 'unknown';
let token = 0;

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
type Hook = ReturnType<typeof renderHook<ReturnType<typeof useCockpitAutoDial>, unknown>>;

/** A sessão SIP da discagem mais recente entra e termina; o webhook diz se o lead atendeu. */
async function finish(hook: Hook, answer: 'answered' | 'not_answered') {
  token = vi.mocked(reserveWebphoneDial).mock.results.at(-1)!.value.seq;
  phone.call = { integrated: true, phase: 'active', dialToken: `tok-${token}` };
  leadAnswer = 'unknown';
  hook.rerender();
  await advance(0);
  phone.call = { integrated: true, phase: 'ended', dialToken: `tok-${token}` };
  leadAnswer = answer;
  hook.rerender();
  await advance(0);
}

/** Motor real, 1ª ligação atendida: parado no desfecho. */
async function droppedCall() {
  const hook = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
  await act(async () => {
    await hook.result.current.start();
  });
  await advance(5000);
  await finish(hook, 'answered');
  expect(hook.result.current.state).toMatchObject({ phase: 'awaiting-sdr', reason: 'answered' });
  return hook;
}
async function redial(hook: Hook) {
  await act(async () => {
    hook.result.current.redial!();
  });
  await advance(0);
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
  vi.mocked(dialingBlockReason).mockReturnValue(null);
  vi.mocked(getNextAutoDialCardAction).mockResolvedValue(next);
  vi.mocked(dialAutoLeadAction).mockReset().mockResolvedValueOnce(dialed('call-1', 3)).mockResolvedValueOnce(dialed('call-2', 4)).mockResolvedValueOnce(dialed('call-3', 5));
  vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue(verdict);
  vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValue({ success: true, data: { confirmed: true } });
});
afterEach(() => vi.useRealTimers());

describe('hook: "Ligar de novo"', () => {
  it('disca na hora para o mesmo número e, atendendo, o desfecho vai para a ligação nova', async () => {
    const hook = await droppedCall();
    await redial(hook);
    expect(dialAutoLeadAction).toHaveBeenLastCalledWith({ leadId: 'A', expectLive: true, redialOf: 'call-1', expectPhone: '11999990000' });
    await finish(hook, 'answered');
    expect(hook.result.current.callId).toBe('call-2');
    expect(hook.result.current.notConversation).toBeUndefined();
    await act(async () => {
      await hook.result.current.confirmOutcome({ disposition: 'relevant_conversation' });
    });
    expect(confirmAutoDialOutcomeAction).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-2' }));
    expect(hook.result.current.state.phase).toBe('countdown');
  });

  it('não atendendo: volta ao desfecho do mesmo lead na ligação anterior, sem no_answer e sem avançar', async () => {
    const hook = await droppedCall();
    await redial(hook);
    await finish(hook, 'not_answered');
    await advance(60_000);
    expect(hook.result.current.state).toMatchObject({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(hook.result.current.callId).toBe('call-1');
    expect(hook.result.current.attemptNo).toBe(3);
    expect(hook.result.current.redialMessage).toBe(REDIAL_NOT_ANSWERED_MESSAGE);
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(getNextAutoDialCardAction).toHaveBeenCalledTimes(1);
    // De novo: a âncora é a última ligação nascida.
    await redial(hook);
    expect(dialAutoLeadAction).toHaveBeenLastCalledWith(expect.objectContaining({ redialOf: 'call-2' }));
  });

  it('recusa e falha incerta: mensagem e a tela de desfecho continua', async () => {
    vi.mocked(dialAutoLeadAction)
      .mockReset()
      .mockResolvedValueOnce(dialed('call-1', 1))
      .mockResolvedValueOnce({ success: true, data: { status: 'refused', code: 'redial_unavailable' } })
      .mockRejectedValueOnce(new Error('rede'));
    const hook = await droppedCall();
    await redial(hook);
    expect(hook.result.current.state).toMatchObject({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(hook.result.current.redialMessage).toContain('Passou do prazo');
    await redial(hook);
    expect(hook.result.current.redialMessage).toBe(REDIAL_UNSURE_MESSAGE);
    expect(hook.result.current.callId).toBe('call-1');
    expect(hook.result.current.notConversation).toBeDefined(); // nenhuma ligação nova nasceu
  });

  it('não disca com a ligação anterior viva no webphone; clique duplo disca uma vez', async () => {
    const hook = await droppedCall();
    phone.call = { integrated: true, phase: 'active', dialToken: 'tok-x' };
    await redial(hook);
    expect(toast.error).toHaveBeenCalledWith(REDIAL_PREVIOUS_ALIVE_MESSAGE);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
    phone.call = null;
    await act(async () => {
      hook.result.current.redial!();
      hook.result.current.redial!();
    });
    await advance(0);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(2);
  });

  it('Pausar durante a religação não perde o desfecho: pausa só depois dele', async () => {
    const hook = await droppedCall();
    await redial(hook);
    act(() => hook.result.current.pause());
    expect(hook.result.current.state.phase).not.toBe('paused');
    await finish(hook, 'not_answered');
    expect(hook.result.current.state.phase).toBe('awaiting-sdr');
    await act(async () => {
      await hook.result.current.confirmOutcome({ disposition: 'relevant_conversation' });
    });
    await advance(0);
    expect(hook.result.current.state).toMatchObject({ phase: 'paused', reason: 'user' });
  });

  it('SDR conclui pelo painel durante a religação: a conversa anterior recebe o desfecho', async () => {
    const hook = await droppedCall();
    await redial(hook);
    await act(async () => {
      hook.result.current.concludeExternally!('A', 'scheduled');
    });
    await advance(0);
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'scheduled' });
  });

  it('sessão que não entra: volta ao desfecho, sem pausar o motor', async () => {
    const hook = await droppedCall();
    await redial(hook);
    await advance(16_000);
    expect(hook.result.current.state).toMatchObject({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(hook.result.current.redialMessage).toBe(REDIAL_SESSION_MISSING_MESSAGE);
    expect(hook.result.current.callId).toBe('call-1');
  });

  it('simulado: religa sem chamar o servidor e volta ao desfecho', async () => {
    vi.mocked(dialAutoLeadAction).mockReset().mockResolvedValue({ success: true, data: { status: 'simulated', attemptNo: 1 } });
    const hook = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: ['answered', 'no_answer'] }));
    await act(async () => {
      await hook.result.current.start();
    });
    await advance(20_000);
    expect(hook.result.current.state.phase).toBe('awaiting-sdr');
    const first = hook.result.current.callId;
    await redial(hook);
    await advance(20_000);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toMatchObject({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(hook.result.current.callId).toBe(first);
  });
});
