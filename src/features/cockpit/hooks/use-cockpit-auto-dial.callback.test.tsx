import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleActivity } from '@/features/activities/actions/schedule-activity';
import {
  concludeAutoDialCallAction,
  confirmAutoDialOutcomeAction,
  dialAutoLeadAction,
  getNextAutoDialCardAction,
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
vi.mock('@/features/integrations/webphone/webphone-call-context', () => ({ setWebphoneCallContext: vi.fn(), requestWebphoneAutoConclude: vi.fn() }));
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
const confirmed = { success: true as const, data: { confirmed: true as const } };

/** Motor real: disca, atende e a ligação termina com o lead atendido => awaiting-sdr. */
async function reachAwaitingLive(rerender: () => void, result: Hook) {
  vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
  phone.call = liveCall('active');
  await startIt(result);
  await advance(5000);
  expect(result.current.state.phase).toBe('in-call');
  leadAnswer = 'answered';
  phone.call = liveCall('ended');
  rerender();
  await advance(3000);
  expect(result.current.state.phase).toBe('awaiting-sdr');
}

async function callbackNow(result: Hook, notes?: string) {
  let out: Awaited<ReturnType<NonNullable<Hook['current']['scheduleCallback']>>> | undefined;
  await act(async () => {
    out = await result.current.scheduleCallback?.({ scheduledAt: AT, notes });
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

describe('scheduleCallback (Ligar depois) — ligação real', () => {
  beforeEach(() => {
    vi.mocked(scheduleActivity).mockResolvedValue(scheduled);
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValue(confirmed);
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValue(ok('B'));
  });

  it('agenda o retorno (sem executedStep, pausando a cadência) e DEPOIS confirma callback_requested com as notas', async () => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);

    const out = await callbackNow(result, 'Ligar depois das 16h');
    expect(out).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledTimes(1);
    expect(scheduleActivity).toHaveBeenCalledWith({
      leadId: 'A',
      channel: 'phone',
      scheduledAt: AT.toISOString(),
      notes: 'Ligar depois das 16h',
      pauseCadenceUntilReturn: true,
    });
    expect(vi.mocked(scheduleActivity).mock.calls[0]?.[0]).not.toHaveProperty('executedStep');
    expect(confirmAutoDialOutcomeAction).toHaveBeenCalledWith({ callId: 'call-1', disposition: 'callback_requested', notes: 'Ligar depois das 16h' });
    expect(vi.mocked(scheduleActivity).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(confirmAutoDialOutcomeAction).mock.invocationCallOrder[0] as number);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });

  it('o lead NÃO entra no excluded da sessão (volta quando o retorno vencer)', async () => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);
    await callbackNow(result);
    await advance(0);
    const calls = vi.mocked(getNextAutoDialCardAction).mock.calls;
    expect(calls.at(-1)?.[0]).toMatchObject({ excludeLeadIds: [] });

  });

  it('falha ao agendar o retorno: NÃO confirma o desfecho e devolve o erro (o motor segue em awaiting-sdr)', async () => {
    vi.mocked(scheduleActivity).mockResolvedValue({ success: false, error: 'Lead não encontrado' });
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);
    const out = await callbackNow(result);
    expect(out).toEqual({ ok: false, error: 'Lead não encontrado' });
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('awaiting-sdr');
  });

  it('falha ao confirmar DEPOIS do retorno: erro claro; tentar de novo reenvia só o desfecho (retorno não é regravado)', async () => {
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValueOnce({ success: false, error: 'falhou' }).mockResolvedValue(confirmed);
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);

    const first = await callbackNow(result);
    expect(first).toMatchObject({ ok: false });
    expect((first as { error: string }).error).toContain('retorno foi agendado');
    expect(result.current.state.phase).toBe('awaiting-sdr');
    expect(scheduleActivity).toHaveBeenCalledTimes(1);

    const second = await callbackNow(result);
    expect(second).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledTimes(1); // NÃO regravou o retorno
    expect(confirmAutoDialOutcomeAction).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });

  it('horário no passado / sem folga de 10 min: recusa sem gravar nada', async () => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);
    let out: unknown;
    await act(async () => {
      out = await result.current.scheduleCallback?.({ scheduledAt: new Date('2026-11-13T15:05:00Z') });
    });
    expect(out).toMatchObject({ ok: false });
    expect(scheduleActivity).not.toHaveBeenCalled();
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
  });
});

describe('scheduleCallback (Ligar depois) — simulado', () => {
  it('não chama server action nenhuma, devolve ok e o motor segue; o lead NÃO entra no excluded', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000 + 8000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });

    const out = await callbackNow(result, 'x');
    expect(out).toEqual({ ok: true });
    expect(scheduleActivity).not.toHaveBeenCalled();
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    expect(concludeAutoDialCallAction).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    await advance(0);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0]).toMatchObject({ excludeLeadIds: [] });
  });

  it('controle: confirmOutcome comum continua colocando o lead no excluded', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000 + 8000);
    await act(async () => {
      await result.current.confirmOutcome({ disposition: 'relevant_conversation' });
    });
    await advance(0);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
  });
});

describe('scheduleCallback com "Indicou outra pessoa" (referred_contact)', () => {
  beforeEach(() => {
    vi.mocked(scheduleActivity).mockResolvedValue(scheduled);
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValue(confirmed);
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValue(ok('B'));
  });

  const refer = async (result: Hook) => {
    let out: unknown;
    await act(async () => {
      out = await result.current.scheduleCallback?.({ scheduledAt: AT, notes: 'Retorno com José', callNotes: 'Indicou José', disposition: 'referred_contact' });
    });
    return out;
  };

  it('pausa a cadência, grava referred_contact com a anotação da ligação e o lead NÃO sai da sessão', async () => {
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);
    expect(await refer(result)).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledWith({ leadId: 'A', channel: 'phone', scheduledAt: AT.toISOString(), notes: 'Retorno com José', pauseCadenceUntilReturn: true });
    expect(confirmAutoDialOutcomeAction).toHaveBeenCalledWith({ callId: 'call-1', disposition: 'referred_contact', notes: 'Indicou José' });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    await advance(0);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0]).toMatchObject({ excludeLeadIds: [] });
  });

  it('desfecho falhou: avisa que o retorno já está salvo; de novo reenvia só o desfecho', async () => {
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValueOnce({ success: false, error: 'falhou' }).mockResolvedValue(confirmed);
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);
    expect(await refer(result)).toMatchObject({ ok: false, retornoSaved: true });
    expect(await refer(result)).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledTimes(1);
    expect(confirmAutoDialOutcomeAction).toHaveBeenCalledTimes(2);
  });

  it('reenvio depois que o horário já passou da folga: manda o desfecho assim mesmo (o retorno está salvo)', async () => {
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValueOnce({ success: false, error: 'falhou' }).mockResolvedValue(confirmed);
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);
    await refer(result);
    vi.setSystemTime(new Date(AT.getTime() - 60_000));
    expect(await refer(result)).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledTimes(1);
  });

  it('"Ligar depois" que ficou pela metade não é reaproveitado: a indicação agenda o próprio retorno', async () => {
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValueOnce({ success: false, error: 'falhou' }).mockResolvedValue(confirmed);
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(rerender, result);
    await callbackNow(result, 'x');
    expect(await refer(result)).toEqual({ ok: true });
    expect(scheduleActivity).toHaveBeenCalledTimes(2);
  });

  it('com a ligação ainda no ar: conclui pelo painel com kind referred ao fim dela', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');
    expect(await refer(result)).toEqual({ ok: true });
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    phone.call = liveCall('ended');
    rerender();
    await advance(3000);
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'referred' });
  });
});

describe('"abrir o lead" da indicação pausa a fila (mesmo caminho do botão Pausar)', () => {
  const NOTICE = 'Fila pausada. Ligue para José e depois toque em Retomar.';
  beforeEach(() => {
    vi.mocked(scheduleActivity).mockResolvedValue(scheduled);
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValue(confirmed);
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValue(ok('B'));
  });

  const refer = async (result: Hook, pauseQueueFor?: string) => {
    let out: unknown;
    await act(async () => {
      out = await result.current.scheduleCallback?.({ scheduledAt: AT, disposition: 'referred_contact', ...(pauseQueueFor ? { pauseQueueFor } : {}) });
    });
    return out;
  };
  const awaiting = async () => {
    const hook = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await reachAwaitingLive(hook.rerender, hook.result);
    return hook.result;
  };

  it('grava e DEPOIS pausa: não disca o próximo até o SDR retomar', async () => {
    const result = await awaiting();
    expect(await refer(result, 'José')).toEqual({ ok: true });
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'user' });
    expect(toast.info).toHaveBeenCalledWith(NOTICE);
    await advance(30_000);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
    act(() => result.current.resume());
    expect(result.current.state.phase).toBe('countdown');
  });

  it('"seguir a fila" não pausa', async () => {
    const result = await awaiting();
    await refer(result);
    expect(result.current.state.phase).toBe('countdown');
    expect(toast.info).not.toHaveBeenCalledWith(NOTICE);
  });

  it('desfecho falhou: não pausa nem avisa; no reenvio que dá certo, pausa', async () => {
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValueOnce({ success: false, error: 'falhou' }).mockResolvedValue(confirmed);
    const result = await awaiting();
    expect(await refer(result, 'José')).toMatchObject({ ok: false });
    expect(result.current.state.phase).toBe('awaiting-sdr');
    expect(toast.info).not.toHaveBeenCalledWith(NOTICE);
    await refer(result, 'José');
    expect(result.current.state.phase).toBe('paused');
  });

  it('ligação ainda no ar: não corta; pausa quando ela termina, com o desfecho registrado', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(dialed);
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(await refer(result, 'José')).toEqual({ ok: true });
    expect(result.current.state.phase).toBe('concluded-call');
    expect(hangupCall).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalledWith(NOTICE);
    phone.call = liveCall('ended');
    rerender();
    await advance(3000);
    expect(concludeAutoDialCallAction).toHaveBeenCalledWith({ callId: 'call-1', kind: 'referred' });
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'user' });
    expect(toast.info).toHaveBeenCalledWith(NOTICE);
    await advance(30_000);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
  });
});

