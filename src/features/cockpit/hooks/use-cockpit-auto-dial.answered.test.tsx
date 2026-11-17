import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyAutoDialAnsweredAction, confirmAutoDialOutcomeAction, dialAutoLeadAction, getNextAutoDialCardAction, resolveAutoDialNoAnswerAction } from '../actions/auto-dial';
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
});
afterEach(() => vi.useRealTimers());


const liveCall = (phase: string) => ({ integrated: true, phase, dialToken: 'tok' });
const verdict = (v: 'conversou' | 'nao_conversou', machine = false) => ({ success: true as const, data: { status: 'verdict' as const, verdict: v, reason: machine ? 'machine' : 'too_short', machine } });

/** Liga o motor real, discando o lead A (tentativa `attemptNo`), e termina a ligação com o lead atendendo. */
async function endAnswered(attemptNo = 1) {
  vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo } });
  phone.call = liveCall('active');
  const hook = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
  await startIt(hook.result);
  await advance(5000);
  phone.call = liveCall('ended');
  leadAnswer = 'answered';
  hook.rerender();
  await advance(0);
  return hook;
}

describe('atendida: conversou ou volta para a fila (PR-B)', () => {
  it('conversou: pausa no awaiting-sdr (as três ações), sem aviso', async () => {
    const { result } = await endAnswered();
    expect(classifyAutoDialAnsweredAction).toHaveBeenCalledWith({ callId: 'call-1' });
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(result.current.notice).toBeNull();
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
  });

  it('caixa postal (máquina) na 1ª tentativa: volta para a fila com aviso, sem gravar', async () => {
    vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue(verdict('nao_conversou', true));
    const { result } = await endAnswered(1);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(result.current.notice).toBe(VOICEMAIL_NOTICE);
    expect(result.current.statusText).toContain(VOICEMAIL_NOTICE);
    expect(result.current.statusText).not.toMatch(/motor/i);
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
  });

  it('atendida curtíssima sem máquina (2ª tentativa): aviso "Não atendeu", segue sem gravar', async () => {
    vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue(verdict('nao_conversou'));
    const { result } = await endAnswered(2);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(result.current.notice).toBe(NOT_ANSWERED_NOTICE);
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
  });

  it('3ª tentativa de máquina: registra pelo caminho da não atendida, avisando o servidor que não foi conversa', async () => {
    vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue(verdict('nao_conversou', true));
    const { result } = await endAnswered(3);
    await advance(0);
    expect(resolveAutoDialNoAnswerAction).toHaveBeenCalledWith({ callId: 'call-1', notConversation: true });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });

  it('sem hangup ainda: consulta de novo e decide quando o veredito chega', async () => {
    vi.mocked(classifyAutoDialAnsweredAction)
      .mockResolvedValueOnce({ success: true, data: { status: 'pending' } })
      .mockResolvedValue(verdict('nao_conversou', true));
    const { result } = await endAnswered(1);
    expect(result.current.state).toEqual({ phase: 'resolving' });
    await advance(2000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(classifyAutoDialAnsweredAction).toHaveBeenCalledTimes(2);
  });

  it('20 s sem veredito: fail-open, conversou (o SDR decide)', async () => {
    vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue({ success: true, data: { status: 'pending' } });
    const { result } = await endAnswered(1);
    await advance(22_000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
  });

  it('server action que NUNCA resolve: aos 20 s cai em conversou; a resposta tardia é ignorada', async () => {
    let late: (v: unknown) => void = () => undefined;
    vi.mocked(classifyAutoDialAnsweredAction).mockImplementation(() => new Promise((resolve) => (late = resolve as (v: unknown) => void)) as never);
    const { result } = await endAnswered(1);
    await advance(19_000);
    expect(result.current.state).toEqual({ phase: 'resolving' });
    await advance(2_000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    await act(async () => {
      late(verdict('nao_conversou', true)); // chega tarde: o SDR já está vendo as 3 ações
    });
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(result.current.notice).toBeNull();
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
  });

  it('caminho normal: depois de decidir, o timeout de 20 s não age de novo', async () => {
    vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue(verdict('nao_conversou', true));
    const { result } = await endAnswered(1);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    await advance(1_000);
    const next = vi.mocked(getNextAutoDialCardAction).mock.calls.length;
    await advance(21_000);
    // Nunca vira awaiting-sdr por um timeout atrasado; o motor segue o caminho da fila.
    expect(result.current.state.phase).not.toBe('awaiting-sdr');
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.length).toBeGreaterThanOrEqual(next);
  });

  it('erro ao classificar: fail-open, conversou', async () => {
    vi.mocked(classifyAutoDialAnsweredAction).mockResolvedValue({ success: false, error: 'falhou' });
    const { result } = await endAnswered(1);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
  });

  it('não atendida pelo webhook (sem answered_at): igual a hoje, com o aviso e sem classificar', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } });
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    phone.call = liveCall('ended');
    leadAnswer = 'not_answered';
    rerender();
    await advance(0);
    expect(classifyAutoDialAnsweredAction).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(result.current.notice).toBe(NOT_ANSWERED_NOTICE);
  });
});

describe('notConversation ("Não foi conversa")', () => {
  it('1ª/2ª tentativa: segue para a fila sem gravar e o lead NÃO sai da sessão', async () => {
    const { result } = await endAnswered(1);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    act(() => result.current.notConversation?.());
    await advance(0);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(result.current.notice).toBe(NOT_ANSWERED_NOTICE);
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    // O lead A não foi para a lista de excluídos da sessão.
    await advance(5000);
    const input = vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0] as { excludeLeadIds?: string[] };
    expect(input.excludeLeadIds ?? []).not.toContain('A');
  });

  it('3ª tentativa: grava pelo caminho da não atendida (servidor decide voicemail/no_answer)', async () => {
    const { result } = await endAnswered(3);
    act(() => result.current.notConversation?.());
    await advance(0);
    expect(resolveAutoDialNoAnswerAction).toHaveBeenCalledWith({ callId: 'call-1', notConversation: true });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });

  it('fora do awaiting-sdr é ignorado', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    act(() => result.current.notConversation?.());
    expect(result.current.state).toEqual({ phase: 'off' });
  });

  it('simulado: só segue, nada é gravado nem classificado', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValue(ok('A'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000 + 8000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    act(() => result.current.notConversation?.());
    await advance(0);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(classifyAutoDialAnsweredAction).not.toHaveBeenCalled();
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
  });
});
