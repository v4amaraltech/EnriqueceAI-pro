import { describe, expect, it } from 'vitest';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

import {
  AUTO_DIAL_COUNTDOWN_SECONDS,
  type AutoDialEvent,
  type AutoDialState,
  describeAutoDial,
  findNextAutoDialIndex,
  initialAutoDialState,
  isAutoDialEligible,
  isAutoDialRunning,
  reduceAutoDial,
} from './auto-dialer';

function run(events: AutoDialEvent[], from: AutoDialState = initialAutoDialState): AutoDialState {
  return events.reduce(reduceAutoDial, from);
}

const ticks = (n: number): AutoDialEvent[] => Array.from({ length: n }, () => ({ type: 'tick' }));
const toInCall: AutoDialEvent[] = [{ type: 'start' }, ...ticks(AUTO_DIAL_COUNTDOWN_SECONDS), { type: 'dial_started' }];

describe('reduceAutoDial — laço principal', () => {
  it('start → contagem de 5 s → discando ao zerar', () => {
    expect(run([{ type: 'start' }])).toEqual({ phase: 'countdown', secondsLeft: 5 });
    expect(run([{ type: 'start' }, ...ticks(4)])).toEqual({ phase: 'countdown', secondsLeft: 1 });
    expect(run([{ type: 'start' }, ...ticks(5)])).toEqual({ phase: 'dialing' });
  });

  it('"Ligar agora" pula a contagem', () => {
    expect(run([{ type: 'start' }, { type: 'dial_now' }])).toEqual({ phase: 'dialing' });
  });

  it('não atendeu → registra sozinho → nova contagem para o próximo', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'not_answered' }]);
    expect(s).toEqual({ phase: 'auto-completing' });
    expect(run([{ type: 'completed' }], s)).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('atendeu → para e espera o SDR; Concluir volta a contar', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'answered' }]);
    expect(s).toEqual({ phase: 'awaiting-sdr', reason: 'answered' });
    expect(run([{ type: 'tick' }, { type: 'dial_now' }], s)).toEqual(s);
    expect(run([{ type: 'sdr_concluded' }], s)).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('20 s sem sinal da API4COM → o SDR decide', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'answer_timeout' }]);
    expect(s).toEqual({ phase: 'awaiting-sdr', reason: 'timeout' });
  });

  it('ignora sinal de atendimento antes de a ligação acabar', () => {
    expect(run([...toInCall, { type: 'lead_answer', answer: 'not_answered' }])).toEqual({ phase: 'in-call' });
  });
});

describe('reduceAutoDial — pausas e falhas', () => {
  it('falha ao discar pausa com o motivo', () => {
    const s = run([{ type: 'start' }, { type: 'dial_now' }, { type: 'dial_failed', message: 'ramal ocupado' }]);
    expect(s).toEqual({ phase: 'paused', reason: 'dial_failed', message: 'ramal ocupado' });
    expect(describeAutoDial(s)).toBe('Pausada: ramal ocupado');
  });

  it('falha ao registrar o resultado pausa', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'not_answered' }, { type: 'complete_failed', message: 'erro' }]);
    expect(s).toMatchObject({ phase: 'paused', reason: 'complete_failed' });
  });

  it('pausa do SDR em qualquer fase; retomar recomeça a contagem', () => {
    const s = run([{ type: 'start' }, ...ticks(2), { type: 'pause', reason: 'user' }]);
    expect(s).toEqual({ phase: 'paused', reason: 'user', message: null });
    expect(run([{ type: 'tick' }, { type: 'dial_now' }], s)).toEqual(s);
    expect(run([{ type: 'resume' }], s)).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('próximo lead (Pular) recomeça a contagem', () => {
    expect(run([{ type: 'start' }, ...ticks(3), { type: 'next_lead' }])).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('stop desliga de qualquer fase e off ignora o resto', () => {
    expect(run([...toInCall, { type: 'stop' }])).toEqual({ phase: 'off' });
    expect(run([{ type: 'tick' }, { type: 'dial_now' }, { type: 'completed' }])).toEqual({ phase: 'off' });
  });

  it('isAutoDialRunning só nas fases em que o SDR não precisa agir', () => {
    expect(isAutoDialRunning(run([{ type: 'start' }]))).toBe(true);
    expect(isAutoDialRunning(run([...toInCall]))).toBe(true);
    expect(isAutoDialRunning(run([...toInCall, { type: 'call_ended' }, { type: 'answer_timeout' }]))).toBe(false);
    expect(isAutoDialRunning(initialAutoDialState)).toBe(false);
  });
});

function item(id: string, over: Partial<DialerQueueItem> = {}): DialerQueueItem {
  return {
    enrollmentId: id,
    leadId: `l-${id}`,
    leadName: id,
    firstName: null,
    lastName: null,
    companyName: id,
    phone: '(11) 99999-0000',
    phones: [],
    cadenceName: 'C',
    cadenceId: 'c',
    stepId: 's',
    stepOrder: 1,
    totalSteps: 3,
    nextStepDue: '2026-10-22T10:00:00Z',
    activityName: null,
    callScript: null,
    currentStepIsPhone: true,
    ...over,
  };
}

describe('elegibilidade', () => {
  it('pula feitos, sem telefone e fora da etapa de ligação', () => {
    const queue = [item('a'), item('b', { currentStepIsPhone: false }), item('c', { phone: null }), item('d')];
    const done = new Set(['a']);
    expect(isAutoDialEligible(queue[0]!, done)).toBe(false);
    expect(isAutoDialEligible(queue[1]!, done)).toBe(false);
    expect(isAutoDialEligible(queue[2]!, done)).toBe(false);
    expect(findNextAutoDialIndex(queue, -1, done)).toBe(3);
    expect(findNextAutoDialIndex(queue, 3, done)).toBe(-1);
  });
});
