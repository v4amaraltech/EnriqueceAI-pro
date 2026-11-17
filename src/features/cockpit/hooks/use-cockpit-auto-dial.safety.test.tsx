import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { concludeAutoDialCallAction, dialAutoLeadAction, getNextAutoDialCardAction } from '../actions/auto-dial';
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

const phone: { call: unknown } = { call: null };
let leadAnswer: 'unknown' | 'answered' | 'not_answered' = 'unknown';

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


import { LIVE_MISMATCH_MESSAGE } from './use-cockpit-auto-dial';
import { TAB_LOCK_KEY } from '../utils/auto-dial-tab-lock';
import { toast } from 'sonner';

const refused = (code: string) => ({ success: true as const, data: { status: 'refused' as const, code: code as never } });

describe('live_mismatch: a página e o servidor discordam do modo (item 2)', () => {
  it('manda expectLive = o modo da página em TODA discagem', async () => {
    const sim = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    await startIt(sim.result);
    await advance(5000);
    expect(dialAutoLeadAction).toHaveBeenLastCalledWith({ leadId: 'A', expectLive: false });
    sim.unmount();
    phone.call = null;
    const real = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(real.result);
    await advance(5000);
    expect(dialAutoLeadAction).toHaveBeenLastCalledWith({ leadId: 'A', expectLive: true });
  });

  it('o servidor recusa com live_mismatch: PAUSA com a mensagem, NÃO disca e zera as tentativas simuladas', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValue(ok('A'));
    vi.mocked(dialAutoLeadAction).mockResolvedValueOnce(sim()).mockResolvedValueOnce(refused('live_mismatch'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    await startIt(result);
    await advance(5000 + 8000); // 1ª tentativa simulada, segue
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0]).toMatchObject({ simulatedAttempts: { A: [expect.any(String)] } });
    await advance(5000); // 2ª discagem: o servidor diz que o modo mudou
    expect(result.current.state).toEqual({ phase: 'paused', reason: 'dial_failed', message: LIVE_MISMATCH_MESSAGE });
    expect(LIVE_MISMATCH_MESSAGE).toBe('O modo da discagem mudou (simulado/real). Recarregue a página para continuar.');
    await advance(30_000);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(2); // não tenta de novo sozinho
    // retomar começa limpo: as tentativas simuladas foram zeradas
    act(() => result.current.resume());
    await advance(0);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0]).toMatchObject({ simulatedAttempts: {} });
  });
});

describe('too_soon: ligação sua em curso ou recém-iniciada (item 3a)', () => {
  it('too_soon espera e escolhe de novo, SEM excluir o lead nem pausar', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValueOnce(refused('too_soon')).mockResolvedValue(sim());
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0]).toMatchObject({ excludeLeadIds: [] });
    await advance(5000);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(2);
    expect(result.current.state.phase).toBe('in-call');
  });

  it('12 too_soon seguidos pausam com o motivo (webhook que nunca chega não prende o motor para sempre)', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(refused('too_soon'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    for (let i = 0; i < 14; i++) await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
    expect(vi.mocked(dialAutoLeadAction).mock.calls.length).toBe(12);
  });
});

describe('uma aba só por navegador (item 3b)', () => {
  it('a 2ª aba vê "A discagem já está rodando em outra aba." e NÃO inicia (também no simulado)', async () => {
    const first = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(first.result);
    expect(first.result.current.state.phase).toBe('countdown');
    const calls = vi.mocked(getNextAutoDialCardAction).mock.calls.length;
    const second = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(second.result);
    expect(second.result.current.state).toEqual({ phase: 'off' });
    expect(second.result.current.startError).toBe('A discagem já está rodando em outra aba.');
    expect(toast.error).toHaveBeenCalledWith('A discagem já está rodando em outra aba.');
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.length).toBe(calls);
  });

  it('também no modo real; e quando a 1ª aba para, a 2ª consegue iniciar', async () => {
    const first = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(first.result);
    const second = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(second.result);
    expect(second.result.current.state.phase).toBe('off');
    act(() => first.result.current.stop());
    await advance(0);
    expect(window.localStorage.getItem(TAB_LOCK_KEY)).toBeNull();
    await startIt(second.result);
    expect(second.result.current.state.phase).toBe('countdown');
    expect(second.result.current.startError).toBeNull();
  });

  it('o batimento mantém o lock vivo (aba que roda por mais de 10 s não perde o lock)', async () => {
    const first = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(first.result);
    act(() => first.result.current.pause()); // fica ligada (pausada), só o batimento corre
    await advance(30_000);
    const second = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(second.result);
    expect(second.result.current.state.phase).toBe('off');
    expect(second.result.current.startError).toBe('A discagem já está rodando em outra aba.');
  });

  it('lock abandonado (aba fechada sem soltar, >10 s) não bloqueia', async () => {
    window.localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId: 'aba-morta', at: Date.now() - 11_000 }));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    expect(result.current.state.phase).toBe('countdown');
  });

  it('se OUTRA aba assumir o lock com o motor rodando, esta pausa com o motivo', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    window.localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId: 'outra-aba', at: Date.now() }));
    await advance(4000);
    expect(result.current.state).toMatchObject({ phase: 'paused', message: 'A discagem passou para outra aba.' });
  });

  it('desmontar solta o lock (e não apaga o de outra aba)', async () => {
    const { result, unmount } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    expect(window.localStorage.getItem(TAB_LOCK_KEY)).not.toBeNull();
    unmount();
    expect(window.localStorage.getItem(TAB_LOCK_KEY)).toBeNull();
    window.localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId: 'outra-aba', at: Date.now() }));
    const other = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    other.unmount(); // nunca iniciou: não toca no lock alheio
    expect(JSON.parse(window.localStorage.getItem(TAB_LOCK_KEY)!).tabId).toBe('outra-aba');
  });

  it('Iniciar sem a flag (enabled=false) não trava nem toca no storage', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: false, live: false }));
    await startIt(result);
    expect(window.localStorage.getItem(TAB_LOCK_KEY)).toBeNull();
  });
});
