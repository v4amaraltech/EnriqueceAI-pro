import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getNextAutoDialCardAction, dialAutoLeadAction, resolveAutoDialNoAnswerAction, confirmAutoDialOutcomeAction } from '../actions/auto-dial';
import { useApi4ComWebphone } from '@/features/integrations/webphone/useApi4ComWebphone';
import { useWebphoneLeadAnswer } from '@/features/integrations/webphone/useWebphoneLeadAnswer';
import { hangupCall, prepareWebphoneMicForDial } from '@/features/integrations/webphone/webphone-client';
import { setWebphoneCallContext } from '@/features/integrations/webphone/webphone-call-context';
import { dialingBlockReason } from '@/features/integrations/webphone/webphone-state';
import { toast } from 'sonner';

import { useCockpitAutoDial } from './use-cockpit-auto-dial';

vi.mock('../actions/auto-dial', () => ({
  getNextAutoDialCardAction: vi.fn(),
  dialAutoLeadAction: vi.fn(),
  resolveAutoDialNoAnswerAction: vi.fn(),
  // Veredito padrão: conversou (as ligações atendidas dos testes seguem para awaiting-sdr).
  classifyAutoDialAnsweredAction: vi.fn(async () => ({ success: true, data: { status: 'verdict', verdict: 'conversou', reason: 'long_enough', machine: false } })),
  confirmAutoDialOutcomeAction: vi.fn(),
  getAutoDialCarrierHangupAction: vi.fn(async () => ({ success: true, data: { status: 'none' } })),
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
vi.mock('@/features/integrations/webphone/webphone-call-context', () => ({ setWebphoneCallContext: vi.fn(), requestWebphoneAutoConclude: vi.fn() }));
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
});
afterEach(() => vi.useRealTimers());

describe('motor simulado (FR-18)', () => {
  it('nasce Desligado; não toca no localStorage ao carregar e só guarda o lock de aba depois do Iniciar (nunca "motor ligado") (FR-1, D8)', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const { result, unmount } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    expect(result.current.state).toEqual({ phase: 'off' });
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    await startIt(result);
    // depois do Iniciar, a ÚNICA chave tocada é a do lock de aba
    for (const call of [...get.mock.calls, ...set.mock.calls]) expect(call[0]).toBe('enriqueceai.cockpit-auto-dial.tab-lock.v1');
    unmount();
    // Recarregar = novo hook: começa Desligado de novo (o lock foi solto ao desmontar).
    const again = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    expect(again.result.current.state).toEqual({ phase: 'off' });
    expect(result.current.simulated).toBe(true);
  });

  it('flag desligada: Iniciar não faz nada e nada é consultado', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: false, live: false }));
    await startIt(result);
    expect(result.current.state).toEqual({ phase: 'off' });
    expect(getNextAutoDialCardAction).not.toHaveBeenCalled();
  });

  it('Iniciar → contagem de 5 s → disca (simulado) → não atendeu → próximo lead; nada vai à operadora', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValueOnce(ok('B'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    await startIt(result);
    expect(result.current.state).toMatchObject({ phase: 'countdown', secondsLeft: 5 });
    expect(getNextAutoDialCardAction).toHaveBeenCalledWith({ excludeLeadIds: [], simulatedAttempts: {} });
    await advance(5000);
    expect(dialAutoLeadAction).toHaveBeenCalledWith({ leadId: 'A', expectLive: false, expectContactId: null });
    expect(result.current.state.phase).toBe('in-call');
    expect(result.current.callId).toBe('sim-A-1');
    await advance(8000);
    // 1ª tentativa sem atender: segue para o próximo lead sem gravar nada
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(getNextAutoDialCardAction).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ simulatedAttempts: { A: [expect.any(String)] } });
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('atendeu: PAUSA e espera o SDR; só segue depois do clique em confirmar', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValueOnce(ok('B'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000 + 8000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(result.current.statusText).toBe('Em conversa: confirme o desfecho para seguir');
    await advance(10 * 60_000); // o tempo passa e o motor continua parado
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(getNextAutoDialCardAction).toHaveBeenCalledTimes(1);

    let done = false;
    await act(async () => {
      done = await result.current.confirmOutcome({ disposition: 'relevant_conversation' });
    });
    expect(done).toBe(true);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    // simulado: o servidor NÃO é chamado para gravar o desfecho
    expect(confirmAutoDialOutcomeAction).not.toHaveBeenCalled();
    // o atendido sai da sessão (FR-9b/FR-17)
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
  });

  it('3ª tentativa sem atender: sinaliza gravar no_answer e segue (simulado não grava)', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue(sim(3));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    await startIt(result);
    await advance(5000 + 8000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it('Parar no meio da ligação volta a Desligado e NÃO derruba a ligação', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'answered' }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');
    act(() => result.current.stop());
    expect(result.current.state).toEqual({ phase: 'off' });
    await advance(20_000);
    expect(result.current.state).toEqual({ phase: 'off' }); // o fim fictício da ligação é ignorado
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('servidor recusa por horário/feriado/teto: Bloqueado (a trava é do servidor)', async () => {
    for (const code of ['outside_hours', 'holiday', 'daily_cap'] as const) {
      vi.mocked(dialAutoLeadAction).mockResolvedValueOnce({ success: true, data: { status: 'refused', code } });
      const { result, unmount } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
      await startIt(result);
      await advance(5000);
      expect(result.current.state).toEqual({ phase: 'blocked', reason: code });
      unmount(); // uma aba só: solta o lock antes do próximo motor
    }
  });

  it('a próxima escolha já pode vir bloqueada pelo servidor', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValue({ success: true, data: { status: 'blocked', code: 'daily_cap' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    await advance(0);
    expect(result.current.state).toEqual({ phase: 'blocked', reason: 'daily_cap' });
    expect(dialAutoLeadAction).not.toHaveBeenCalled();
  });

  it('sem lead: Bloqueado (empty); nada é discado', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValue({ success: true, data: { status: 'empty' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    await advance(6000);
    expect(result.current.state).toEqual({ phase: 'blocked', reason: 'empty' });
    expect(dialAutoLeadAction).not.toHaveBeenCalled();
  });

  it('lead que mudou entre a escolha e a discagem (held): sai da sessão e o motor escolhe outro (FR-10, FR-17)', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValueOnce(ok('B'));
    vi.mocked(dialAutoLeadAction).mockResolvedValueOnce({ success: true, data: { status: 'refused', code: 'held' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
  });

  it('lead_unavailable (ganho / não retomar): pula o lead, escolhe o PRÓXIMO elegível e disca esse, sem pausar', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('W')).mockResolvedValueOnce(ok('B'));
    vi.mocked(dialAutoLeadAction)
      .mockResolvedValueOnce({ success: true, data: { status: 'refused', code: 'lead_unavailable' } })
      .mockResolvedValueOnce(sim());
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['W'] });
    await advance(5000);
    expect(vi.mocked(dialAutoLeadAction).mock.calls[1]?.[0]).toMatchObject({ leadId: 'B' });
  });

  it('lead_unavailable sempre: não fica em laço (pausa depois de recusas demais)', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'refused', code: 'lead_unavailable' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    for (let i = 0; i < 8; i++) await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
  });

  it('recusas seguidas demais pausam o motor (sem laço infinito)', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'refused', code: 'held' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    for (let i = 0; i < 8; i++) await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
  });

  it('ninguém liberado (intervalo de 1 h): Aguardando e acorda 1 s depois da hora', async () => {
    const until = Date.now() + 60_000;
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce({ success: true, data: { status: 'waiting', until } }).mockResolvedValueOnce(ok('A'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    await advance(0);
    expect(result.current.state).toEqual({ phase: 'waiting', until });
    await advance(60_000);
    expect(result.current.state.phase).toBe('waiting');
    await advance(1_000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(getNextAutoDialCardAction).toHaveBeenCalledTimes(2);
  });

  it('424 simulado: tenta de novo a cada 5 s por até 1 min e depois pausa com o motivo (A-D11)', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'ramal_busy' }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('releasing');
    await advance(5000);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(2); // a cada 5 s, não 15 s
    await advance(54_000);
    expect(result.current.state.phase).toBe('releasing'); // ainda dentro de 1 min
    await advance(2_000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(13); // 1ª + 12 retentativas (t = 0, 5, ..., 60 s)
  });

  it('erro da escolha pausa com o motivo (não repete sozinho)', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValue({ success: false, error: 'Falha ao escolher o próximo lead' });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    await advance(6000);
    expect(result.current.state).toMatchObject({ phase: 'paused', message: 'Falha ao escolher o próximo lead' });
  });

  it('Pausar e Retomar', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false }));
    await startIt(result);
    act(() => result.current.pause());
    expect(result.current.state.phase).toBe('paused');
    await advance(10_000);
    expect(dialAutoLeadAction).not.toHaveBeenCalled();
    act(() => result.current.resume());
    expect(result.current.state.phase).toBe('countdown');
  });
});

describe('fila (queue)', () => {
  it('sem a opção ou "normal": as chamadas ao servidor ficam IDÊNTICAS às de antes (sem o campo queue)', async () => {
    const first = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    const result = first.result;
    await startIt(result);
    await advance(5000);
    expect(getNextAutoDialCardAction).toHaveBeenCalledWith({ excludeLeadIds: [], simulatedAttempts: {} });
    expect(dialAutoLeadAction).toHaveBeenCalledWith({ leadId: 'A', expectLive: false, expectContactId: null });
    first.unmount(); // uma aba só: solta o lock antes de abrir outro motor
    const explicit = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, queue: 'normal' }));
    await startIt(explicit.result);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls.at(-1)?.[0]).not.toHaveProperty('queue');
  });

  it('queue "recovery": repassa a fila ao escolher o lead e ao discar', async () => {
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer', queue: 'recovery' }));
    await startIt(result);
    await advance(5000);
    expect(getNextAutoDialCardAction).toHaveBeenCalledWith(expect.objectContaining({ queue: 'recovery', excludeLeadIds: [] }));
    expect(dialAutoLeadAction).toHaveBeenCalledWith({ leadId: 'A', expectLive: false, expectContactId: null, queue: 'recovery' });
  });
});

describe('motor real (as 3 flags), com a discagem MOCKADA', () => {
  const liveCall = (phase: string) => ({ integrated: true, phase, dialToken: 'tok' });

  it('microfone negado no clique: não inicia', async () => {
    vi.mocked(prepareWebphoneMicForDial).mockReturnValue(Promise.resolve('Permita o microfone'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    expect(result.current.state).toEqual({ phase: 'off' });
    expect(toast.error).toHaveBeenCalledWith('Permita o microfone', expect.anything());
    expect(getNextAutoDialCardAction).not.toHaveBeenCalled();
  });

  it('webphone não pronto: pausa com o motivo e NÃO chama o servidor para discar', async () => {
    vi.mocked(dialingBlockReason).mockReturnValue('O ramal está em uso em outra aba');
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state).toEqual({ phase: 'paused', reason: 'blocked', message: 'O ramal está em uso em outra aba' });
    expect(dialAutoLeadAction).not.toHaveBeenCalled();
  });

  it('roteiro: disca, sessão SIP desta aba, fim, não atendeu na 3ª → servidor grava no_answer → próximo', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValue(ok('A'));
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 3 } });
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    // o navegador manda só o leadId; o telefone é lido no servidor
    expect(dialAutoLeadAction).toHaveBeenCalledWith({ leadId: 'A', expectLive: true, expectContactId: null });
    expect(setWebphoneCallContext).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', ownerHandlesResult: true, hideNotes: true, dialToken: 'tok' }));
    expect(result.current.state.phase).toBe('awaiting-session');

    phone.call = liveCall('active');
    rerender();
    await advance(0);
    expect(result.current.state.phase).toBe('in-call');

    phone.call = liveCall('ended');
    leadAnswer = 'not_answered';
    rerender();
    await advance(0);
    expect(resolveAutoDialNoAnswerAction).toHaveBeenCalledWith({ callId: 'call-1' });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(hangupCall).not.toHaveBeenCalled();
  });

  it('1ª tentativa sem atender: segue para o próximo lead SEM chamar o servidor para gravar', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } });
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('in-call');
    phone.call = liveCall('ended');
    leadAnswer = 'not_answered';
    rerender();
    await advance(0);
    expect(resolveAutoDialNoAnswerAction).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });

  it('atendeu: pausa e o clique de confirmar grava o desfecho pelo servidor', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } });
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    phone.call = liveCall('ended');
    leadAnswer = 'answered';
    rerender();
    await advance(0);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    await act(async () => {
      await result.current.confirmOutcome({ disposition: 'answered_no_progress', notes: 'n' });
    });
    expect(confirmAutoDialOutcomeAction).toHaveBeenCalledWith({ callId: 'call-1', disposition: 'answered_no_progress', notes: 'n' });
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
  });

  it('confirmar com falha do servidor NÃO libera o motor', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } });
    vi.mocked(confirmAutoDialOutcomeAction).mockResolvedValue({ success: false, error: 'falhou' });
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    phone.call = liveCall('ended');
    leadAnswer = 'answered';
    rerender();
    await advance(0);
    let done = true;
    await act(async () => {
      done = await result.current.confirmOutcome({ disposition: 'no_answer' });
    });
    expect(done).toBe(false);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
  });

  it('45 s sem sinal da operadora: espera o SDR (não segue sozinho)', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } });
    phone.call = liveCall('active');
    const { result, rerender } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    phone.call = liveCall('ended');
    rerender();
    await advance(45_000);
    expect(result.current.state).toEqual({ phase: 'awaiting-sdr', reason: 'timeout' });
  });

  it('424: tenta de novo a cada 5 s por até 1 min; depois pausa com o motivo (A-D11)', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'ramal_busy', error: 'ocupado' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('releasing');
    await advance(60_000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(13);
  });

  it('424: registra no console o estado do webphone, sem dados pessoais', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'ramal_busy', error: 'ocupado' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    const call = warn.mock.calls.find((c) => String(c[0]).includes('424'));
    expect(call).toBeDefined();
    expect(Object.keys(call?.[1] as object).sort()).toEqual(['callPhase', 'hasCall', 'registration', 'sessionConflict', 'sipSessionOpen']);
    expect(JSON.stringify(call)).not.toMatch(/55\d{8,}|\d{10,}/);
    warn.mockRestore();
  });

  it('424 que passa na 3ª tentativa: o motor segue e a contagem de 1 min recomeça no próximo 424', async () => {
    vi.mocked(dialAutoLeadAction)
      .mockResolvedValueOnce({ success: true, data: { status: 'ramal_busy', error: 'ocupado' } })
      .mockResolvedValueOnce({ success: true, data: { status: 'ramal_busy', error: 'ocupado' } })
      .mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } });
    phone.call = { integrated: true, phase: 'active', dialToken: 'tok' };
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000 + 5000 + 5000);
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(3);
    expect(result.current.state.phase).toBe('in-call');
  });

  it('422 (número inválido): o lead é pulado com o motivo, sai da sessão e o motor segue SEM pausar (A-D12)', async () => {
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(ok('A')).mockResolvedValueOnce(ok('B'));
    vi.mocked(dialAutoLeadAction).mockResolvedValueOnce({ success: true, data: { status: 'invalid_number', error: 'API4COM POST /calls failed (422): numero invalido' } });
    phone.call = null;
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'countdown' });
    expect(result.current.skippedLeads).toEqual([{ leadId: 'A', reason: 'API4COM POST /calls failed (422): numero invalido' }]);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
  });

  it('422 no número do INDICADO: o lead fica; a próxima vai ao principal; se o principal também recusar, aí sai', async () => {
    const withContact = ok('A');
    (withContact.data.card as { callbackContact?: unknown }).callbackContact = { name: 'José', contactId: 'c-1' };
    const refused = ok('A');
    (refused.data.card as { callbackContact?: unknown }).callbackContact = { name: 'José', contactId: null, refused: true };
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce(withContact).mockResolvedValueOnce(refused).mockResolvedValue(ok('B'));
    vi.mocked(dialAutoLeadAction)
      .mockResolvedValueOnce({ success: true, data: { status: 'invalid_number', error: 'failed (422)', contactRefused: true } })
      .mockResolvedValueOnce({ success: true, data: { status: 'invalid_number', error: 'failed (422)' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(vi.mocked(dialAutoLeadAction).mock.calls[0]?.[0]).toMatchObject({ expectContactId: 'c-1', expectContactPhone: '11999990000' });
    expect(result.current.skippedLeads).toEqual([]);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[1]?.[0]).toMatchObject({ excludeLeadIds: [], ignoreContactLeadIds: ['A'] });
    await advance(5000);
    expect(dialAutoLeadAction).toHaveBeenLastCalledWith({ leadId: 'A', expectLive: true, expectContactId: null, ignoreContact: true });
    expect(result.current.skippedLeads).toEqual([{ leadId: 'A', reason: 'failed (422)' }]);
    expect(vi.mocked(getNextAutoDialCardAction).mock.calls[2]?.[0]).toMatchObject({ excludeLeadIds: ['A'] });
  });

  it('vários 422 seguidos pausam o motor (guarda contra laço)', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'invalid_number', error: 'failed (422)' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    for (let i = 0; i < 8; i++) await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
    expect(vi.mocked(dialAutoLeadAction).mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('expõe o contexto extra do lead (origem, perda, último SDR) e o limpa quando não há lead', async () => {
    const extras = {
      leadSource: 'Blackbox', canal: 'whatsapp', createdAt: '2026-01-01T00:00:00Z', lostAt: '2026-10-01T00:00:00Z',
      lossReasonName: 'Sem interesse', lossNotes: 'não quis', previousSdr: { userId: 'u9', name: 'Maria' },
    };
    vi.mocked(getNextAutoDialCardAction).mockResolvedValueOnce({ success: true, data: { status: 'ok', card: cardOf('A'), live: false, tier: 'cold', leadCardExtras: extras, queue: 'normal' } }).mockResolvedValue({ success: true, data: { status: 'empty' } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: false, script: 'no_answer' }));
    await startIt(result);
    await advance(0);
    expect(result.current.leadCardExtras).toEqual(extras);
    await advance(5000 + 8000 + 6000); // liga, não atende, segue; próxima escolha vem vazia
    expect(result.current.leadCardExtras).toBeNull();
  });

  it('POST aceito sem a sessão SIP desta aba em 15 s: pausa e não repete', async () => {
    vi.mocked(dialAutoLeadAction).mockResolvedValue({ success: true, data: { status: 'dialed', callId: 'call-1', providerCallId: 'prov-1', attemptNo: 1 } });
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state.phase).toBe('awaiting-session');
    await advance(2100);
    expect(result.current.state.phase).toBe('awaiting-session'); // 2 s não pausa mais (prazo do Cockpit = 15 s)
    await advance(14_000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'blocked' });
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
  });

  it('erro ao chamar o servidor para discar: pausa (não repete, a operadora pode ter criado a chamada)', async () => {
    vi.mocked(dialAutoLeadAction).mockRejectedValue(new Error('rede'));
    const { result } = renderHook(() => useCockpitAutoDial({ enabled: true, live: true }));
    await startIt(result);
    await advance(5000);
    expect(result.current.state).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
    expect(dialAutoLeadAction).toHaveBeenCalledTimes(1);
  });
});
