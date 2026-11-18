import { describe, expect, it } from 'vitest';

import { AUTO_DIAL_COUNTDOWN_SECONDS } from '@/features/activities/utils/auto-dialer';

import {
  describeCockpitAutoDial,
  initialCockpitAutoDialState,
  isCallInProgress,
  isCockpitAutoDialOn,
  noAnswerEvent,
  reduceCockpitAutoDial,
  type CockpitAutoDialEvent,
  type CockpitAutoDialState,
} from './cockpit-auto-dial-machine';
import { simulateDial } from './simulated-dialer';

const run = (events: CockpitAutoDialEvent[], from: CockpitAutoDialState = initialCockpitAutoDialState): CockpitAutoDialState =>
  events.reduce(reduceCockpitAutoDial, from);

const countdown = { phase: 'countdown', secondsLeft: AUTO_DIAL_COUNTDOWN_SECONDS } as const;
/** Chega a "em ligação": Iniciar → 5 ticks → dialing → dial_started. */
const inCall = (): CockpitAutoDialState =>
  run([{ type: 'start' }, ...Array.from({ length: AUTO_DIAL_COUNTDOWN_SECONDS }, () => ({ type: 'tick' }) as const), { type: 'dial_started' }]);
const resolving = (): CockpitAutoDialState => run([{ type: 'call_ended' }], inCall());

describe('início (FR-1, D8)', () => {
  it('sempre começa Desligado e nada acontece sem Iniciar', () => {
    expect(initialCockpitAutoDialState).toEqual({ phase: 'off' });
    expect(run([{ type: 'tick' }, { type: 'dial_now' }, { type: 'call_ended' }, { type: 'resume' }])).toEqual({ phase: 'off' });
  });
  it('Iniciar → contagem de 5 s → discando', () => {
    expect(run([{ type: 'start' }])).toEqual(countdown);
    const ticks = Array.from({ length: AUTO_DIAL_COUNTDOWN_SECONDS - 1 }, () => ({ type: 'tick' }) as const);
    expect(run([{ type: 'start' }, ...ticks])).toEqual({ phase: 'countdown', secondsLeft: 1 });
    expect(run([{ type: 'start' }, ...ticks, { type: 'tick' }])).toEqual({ phase: 'dialing' });
  });
  it('discando → sessão confirmada → em ligação → fim → conferindo atendimento', () => {
    expect(inCall()).toEqual({ phase: 'in-call' });
    expect(resolving()).toEqual({ phase: 'resolving' });
    expect(run([{ type: 'awaiting_session' }, { type: 'session_confirmed' }], { phase: 'dialing' })).toEqual({ phase: 'in-call' });
  });
});

describe('atendeu (FR-8, FR-9)', () => {
  it('atendeu PAUSA e espera o SDR (não conclui sozinho nem vai para a contagem)', () => {
    expect(run([{ type: 'lead_answer', answer: 'answered' }], resolving())).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
  });
  it('o motor fica parado em "Em conversa" até o SDR confirmar; ticks e wake não o soltam', () => {
    const s = run([{ type: 'lead_answer', answer: 'answered' }], resolving());
    expect(run([{ type: 'tick' }, { type: 'wake' }, { type: 'completed' }, { type: 'dial_now' }], s)).toEqual(s);
  });
  it('SDR confirma o desfecho → contagem → próximo lead', () => {
    const s = run([{ type: 'lead_answer', answer: 'answered' }, { type: 'sdr_concluded' }], resolving());
    expect(s).toEqual(countdown);
  });
  it('texto da tela', () => {
    expect(describeCockpitAutoDial({ phase: 'awaiting-sdr', reason: 'answered' })).toBe('Em conversa: confirme o desfecho para seguir');
  });
});

describe('não atendeu (FR-6, FR-7, D6)', () => {
  it('1ª e 2ª tentativa: segue para o próximo lead (lead volta após 1 h); nada a gravar', () => {
    for (const attemptNo of [1, 2]) {
      const after = run([noAnswerEvent(attemptNo)], resolving());
      expect(after).toEqual({ phase: 'advancing' });
      expect(run([{ type: 'next_lead' }], after)).toEqual(countdown);
    }
  });
  it('3ª tentativa do dia: sinaliza gravar no_answer (auto-completing) e só depois vai ao próximo', () => {
    const after = run([noAnswerEvent(3)], resolving());
    expect(after).toEqual({ phase: 'auto-completing', outcome: 'no_answer' });
    expect(run([{ type: 'completed' }], after)).toEqual(countdown);
  });
  it('falha ao gravar o no_answer pausa com o motivo', () => {
    expect(run([{ type: 'complete_failed', message: 'x' }], { phase: 'auto-completing', outcome: 'no_answer' })).toEqual({
      phase: 'paused',
      reason: 'complete_failed',
      message: 'x',
    });
  });
  it('ninguém liberado: Aguardando até a hora e volta à contagem', () => {
    const waiting = run([{ type: 'wait', until: 1_000 }], { phase: 'advancing' });
    expect(waiting).toEqual({ phase: 'waiting', until: 1_000 });
    expect(run([{ type: 'wake' }], waiting)).toEqual(countdown);
    expect(describeCockpitAutoDial({ phase: 'waiting', until: Date.UTC(2026, 10, 13, 15, 30) })).toBe('Aguardando: próxima ligação liberada às 12:30');
  });
  it('20 s sem sinal da operadora: espera o SDR concluir', () => {
    const s = run([{ type: 'answer_timeout' }], resolving());
    expect(s).toEqual({ phase: 'awaiting-sdr', reason: 'timeout' });
    expect(run([{ type: 'sdr_concluded' }], s)).toEqual(countdown);
  });
});

describe('pausas por erro (FR-15)', () => {
  it('erro da API4COM pausa e não repete sozinho', () => {
    const s = run([{ type: 'dial_failed', message: 'erro' }], { phase: 'dialing' });
    expect(s).toEqual({ phase: 'paused', reason: 'dial_failed', message: 'erro' });
    expect(run([{ type: 'tick' }, { type: 'dial_now' }, { type: 'wake' }], s)).toEqual(s);
  });
  it('POST aceito sem a sessão SIP desta aba pausa', () => {
    expect(run([{ type: 'awaiting_session' }, { type: 'session_missing', message: 'sem sip' }], { phase: 'dialing' })).toEqual({
      phase: 'paused',
      reason: 'blocked',
      message: 'sem sip',
    });
  });
  it('424: libera o ramal e faz UMA nova tentativa', () => {
    const s = run([{ type: 'ramal_busy', until: 5_000 }], { phase: 'dialing' });
    expect(s).toEqual({ phase: 'releasing', until: 5_000 });
    expect(run([{ type: 'ramal_retry' }], s)).toEqual({ phase: 'dialing' });
  });
  it('424 repetido pausa (o hook decide, o redutor aceita pause)', () => {
    expect(run([{ type: 'pause', reason: 'blocked', message: 'ramal ocupado' }], { phase: 'releasing', until: 1 })).toEqual({
      phase: 'paused',
      reason: 'blocked',
      message: 'ramal ocupado',
    });
  });
  it('Pausar e Retomar voltam à contagem', () => {
    const paused = run([{ type: 'pause', reason: 'user' }], countdown);
    expect(paused).toEqual({ phase: 'paused', reason: 'user', message: null });
    expect(run([{ type: 'resume' }], paused)).toEqual(countdown);
  });
});

describe('Bloqueado (FR-11, FR-12)', () => {
  it.each(['outside_hours', 'holiday', 'daily_cap', 'empty'] as const)('servidor recusa (%s) na contagem e no discar', (reason) => {
    expect(run([{ type: 'blocked', reason }], countdown)).toEqual({ phase: 'blocked', reason });
    expect(run([{ type: 'blocked', reason }], { phase: 'dialing' })).toEqual({ phase: 'blocked', reason });
  });
  it('também bloqueia na espera, ao avançar e ao concluir (a janela pode fechar enquanto espera)', () => {
    for (const from of [{ phase: 'waiting', until: 1 }, { phase: 'advancing' }, { phase: 'auto-completing', outcome: 'no_answer' }] as const) {
      expect(run([{ type: 'blocked', reason: 'outside_hours' }], from)).toEqual({ phase: 'blocked', reason: 'outside_hours' });
    }
  });
  it('NÃO derruba ligação em curso: "blocked" é ignorado em em-ligação, conferindo e em conversa', () => {
    for (const from of [inCall(), resolving(), { phase: 'awaiting-sdr', reason: 'answered' } as const, { phase: 'off' } as const]) {
      expect(run([{ type: 'blocked', reason: 'daily_cap' }], from)).toEqual(from);
    }
  });
  it('só sai por Parar (Desligado) ou Iniciar (nova contagem); o resto é ignorado', () => {
    const blocked = { phase: 'blocked', reason: 'daily_cap' } as const;
    expect(run([{ type: 'tick' }, { type: 'resume' }, { type: 'wake' }, { type: 'dial_now' }, { type: 'next_lead' }], blocked)).toEqual(blocked);
    expect(run([{ type: 'stop' }], blocked)).toEqual({ phase: 'off' });
    expect(run([{ type: 'start' }], blocked)).toEqual(countdown);
  });
  it('textos da tela', () => {
    expect(describeCockpitAutoDial({ phase: 'blocked', reason: 'outside_hours' })).toContain('Fora do horário');
    expect(describeCockpitAutoDial({ phase: 'blocked', reason: 'daily_cap' })).toContain('Teto do dia');
    expect(describeCockpitAutoDial({ phase: 'blocked', reason: 'holiday' })).toContain('Feriado');
    expect(describeCockpitAutoDial({ phase: 'blocked', reason: 'empty' })).toContain('Sem leads');
    expect(describeCockpitAutoDial({ phase: 'off' })).toBeNull();
    expect(describeCockpitAutoDial({ phase: 'countdown', secondsLeft: 3 })).toBe('Próxima ligação em 3 s');
  });
});

describe('Parar (FR-13)', () => {
  it.each([
    ['contagem', countdown],
    ['discando', { phase: 'dialing' }],
    ['em ligação', { phase: 'in-call' }],
    ['conferindo', { phase: 'resolving' }],
    ['em conversa', { phase: 'awaiting-sdr', reason: 'answered' }],
    ['aguardando', { phase: 'waiting', until: 1 }],
    ['pausado', { phase: 'paused', reason: 'user', message: null }],
    ['bloqueado', { phase: 'blocked', reason: 'holiday' }],
  ] as Array<[string, CockpitAutoDialState]>)('de %s volta a Desligado', (_n, from) => {
    expect(run([{ type: 'stop' }], from)).toEqual({ phase: 'off' });
  });
  it('depois de Parar, eventos atrasados da ligação em curso são ignorados (a ligação NÃO é derrubada pelo redutor)', () => {
    expect(run([{ type: 'stop' }, { type: 'dial_started' }, { type: 'call_ended' }, { type: 'lead_answer', answer: 'answered' }], inCall())).toEqual({
      phase: 'off',
    });
  });
  it('isCallInProgress deixa a ligação visível para o botão Desligar, que é separado', () => {
    expect(isCallInProgress(inCall())).toBe(true);
    expect(isCallInProgress(resolving())).toBe(true);
    expect(isCallInProgress({ phase: 'dialing' })).toBe(true);
    expect(isCallInProgress(countdown)).toBe(false);
    expect(isCallInProgress({ phase: 'off' })).toBe(false);
    expect(isCockpitAutoDialOn({ phase: 'off' })).toBe(false);
    expect(isCockpitAutoDialOn(countdown)).toBe(true);
  });
});

describe('com o discador simulado (FR-18), roteiro completo', () => {
  /** Roda uma tentativa: contagem → discar (simulado) → fim → resultado. */
  function attempt(from: CockpitAutoDialState, leadId: string, attemptNo: number, script: Parameters<typeof simulateDial>[0]['script']) {
    let s = run(Array.from({ length: AUTO_DIAL_COUNTDOWN_SECONDS }, () => ({ type: 'tick' }) as const), from);
    expect(s).toEqual({ phase: 'dialing' });
    const dial = simulateDial({ leadId, attemptNo, script });
    if (dial.kind === 'ramal_busy') return run([{ type: 'ramal_busy', until: dial.retryAfterMs }], s);
    if (dial.kind === 'failed') return run([{ type: 'dial_failed', message: dial.message }], s);
    s = run([{ type: 'dial_started' }, { type: 'call_ended' }], s);
    return run([dial.answered ? { type: 'lead_answer', answer: 'answered' } : noAnswerEvent(attemptNo)], s);
  }

  it('não atende 3x no mesmo lead: 1ª e 2ª avançam; 3ª grava no_answer e segue', () => {
    let s = run([{ type: 'start' }]);
    s = attempt(s, 'L1', 1, 'no_answer');
    expect(s).toEqual({ phase: 'advancing' });
    s = run([{ type: 'next_lead' }], s);
    s = attempt(s, 'L1', 2, 'no_answer');
    expect(s).toEqual({ phase: 'advancing' });
    s = run([{ type: 'next_lead' }], s);
    s = attempt(s, 'L1', 3, 'no_answer');
    expect(s).toEqual({ phase: 'auto-completing', outcome: 'no_answer' });
    expect(run([{ type: 'completed' }], s)).toEqual(countdown);
  });
  it('atende: pausa até confirmar', () => {
    const s = attempt(run([{ type: 'start' }]), 'L2', 1, 'answered');
    expect(s).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(run([{ type: 'sdr_concluded' }], s)).toEqual(countdown);
  });
  it('424 simulado e erro simulado', () => {
    expect(attempt(run([{ type: 'start' }]), 'L3', 1, 'ramal_busy').phase).toBe('releasing');
    expect(attempt(run([{ type: 'start' }]), 'L3', 1, 'dial_failed')).toMatchObject({ phase: 'paused', reason: 'dial_failed' });
  });
});

describe('noAnswerEvent', () => {
  it('só a última tentativa do dia não leva "then"', () => {
    expect(noAnswerEvent(1)).toEqual({ type: 'lead_answer', answer: 'not_answered', then: 'next_lead' });
    expect(noAnswerEvent(2)).toEqual({ type: 'lead_answer', answer: 'not_answered', then: 'next_lead' });
    expect(noAnswerEvent(3)).toEqual({ type: 'lead_answer', answer: 'not_answered' });
    expect(noAnswerEvent(2, { maxAttemptsPerDay: 2 })).toEqual({ type: 'lead_answer', answer: 'not_answered' });
  });
});

describe('not_conversation (link "Não foi conversa")', () => {
  it('1ª/2ª tentativa: vai para o próximo lead (advancing), sem gravar', () => {
    expect(reduceCockpitAutoDial({ phase: 'awaiting-sdr', reason: 'answered' }, { type: 'not_conversation', attemptNo: 1 })).toEqual({ phase: 'advancing' });
    expect(reduceCockpitAutoDial({ phase: 'awaiting-sdr', reason: 'timeout' }, { type: 'not_conversation', attemptNo: 2 })).toEqual({ phase: 'advancing' });
  });
  it('3ª tentativa: auto-completing(no_answer) = sinal para gravar', () => {
    expect(reduceCockpitAutoDial({ phase: 'awaiting-sdr', reason: 'answered' }, { type: 'not_conversation', attemptNo: 3 })).toEqual({ phase: 'auto-completing', outcome: 'no_answer' });
  });
  it.each([{ phase: 'off' }, { phase: 'in-call' }, { phase: 'resolving' }, { phase: 'concluded-call' }] as CockpitAutoDialState[])('fora do awaiting-sdr (%o) é ignorado', (from) => {
    expect(reduceCockpitAutoDial(from, { type: 'not_conversation', attemptNo: 1 })).toEqual(from);
  });
});
