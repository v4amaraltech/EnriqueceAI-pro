import { describe, expect, it } from 'vitest';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

import {
  AUTO_DIAL_COUNTDOWN_SECONDS,
  type AutoDialEvent,
  type AutoDialState,
  AUTO_DIAL_MIN_GAP_MS,
  availablePhones,
  buildAttemptLog,
  countCallsByPhone,
  decideAfterNoAnswer,
  describeAutoDial,
  initialAutoDialState,
  isAutoDialEligible,
  isAutoDialRunning,
  phoneKey,
  pickNextAutoDial,
  recordAttempt,
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

  it('não atendeu na última tentativa → registra sozinho → nova contagem', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'not_answered', then: 'complete' }]);
    expect(s).toEqual({ phase: 'auto-completing', outcome: 'no_answer' });
    expect(run([{ type: 'completed' }], s)).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('não atendeu com outro número livre → contagem para o mesmo lead', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'not_answered', then: 'next_number' }]);
    expect(s).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('não atendeu com números no intervalo → advancing → próximo lead ou espera', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'not_answered', then: 'next_lead' }]);
    expect(s).toEqual({ phase: 'advancing' });
    expect(isAutoDialRunning(s)).toBe(true);
    expect(run([{ type: 'next_lead' }], s)).toEqual({ phase: 'countdown', secondsLeft: 5 });
    const w = run([{ type: 'wait', until: 123 }], s);
    expect(w).toEqual({ phase: 'waiting', until: 123 });
    expect(run([{ type: 'tick' }], w)).toEqual(w);
    expect(run([{ type: 'wake' }], w)).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('atendeu → conclui sozinho (IA) → nova contagem', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'answered' }]);
    expect(s).toEqual({ phase: 'auto-completing', outcome: 'answered' });
    expect(describeAutoDial(s)).toMatch(/Atendida/);
    expect(run([{ type: 'completed' }], s)).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });

  it('depois de concluir, pode esperar o próximo liberar', () => {
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'answered' }, { type: 'completed' }, { type: 'wait', until: 5 }]);
    expect(s).toEqual({ phase: 'waiting', until: 5 });
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
    const s = run([...toInCall, { type: 'call_ended' }, { type: 'lead_answer', answer: 'not_answered', then: 'complete' }, { type: 'complete_failed', message: 'erro' }]);
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

  it('POST aceito sem sessão fica aguardando e a falta da sessão pausa sem concluir', () => {
    const waiting = run([{ type: 'start' }, { type: 'dial_now' }, { type: 'awaiting_session' }]);
    expect(waiting).toEqual({ phase: 'awaiting-session' });
    expect(isAutoDialRunning(waiting)).toBe(true);
    expect(describeAutoDial(waiting)).toMatch(/webphone desta aba/);
    const paused = run([{ type: 'session_missing', message: 'sem sessão' }], waiting);
    expect(paused).toEqual({ phase: 'paused', reason: 'blocked', message: 'sem sessão' });
    expect(run([{ type: 'session_confirmed' }], waiting)).toEqual({ phase: 'in-call' });
  });

  it('424 espera uma vez e a nova discagem volta a discar; não conclui a atividade', () => {
    const releasing = run([{ type: 'start' }, { type: 'dial_now' }, { type: 'ramal_busy', until: 15_000 }]);
    expect(releasing).toEqual({ phase: 'releasing', until: 15_000 });
    expect(isAutoDialRunning(releasing)).toBe(true);
    expect(run([{ type: 'ramal_retry' }], releasing)).toEqual({ phase: 'dialing' });
    expect(run([{ type: 'call_ended' }, { type: 'lead_answer', answer: 'not_answered', then: 'complete' }], releasing)).toEqual(releasing);
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
    phoneAttempts: [],
    ...over,
  };
}

describe('elegibilidade e rodadas', () => {
  const NOW = Date.parse('2026-11-05T15:00:00Z');
  const LIMIT = 3;
  const two = { phone: '(11) 911110000', phones: [
    { formatted: '(11) 911110000', raw: '5511911110000', label: 'a' },
    { formatted: '(11) 922220000', raw: '5511922220000', label: 'b' },
  ] };

  it('pula feitos, sem telefone e fora da etapa de ligação', () => {
    const queue = [item('a'), item('b', { currentStepIsPhone: false }), item('c', { phone: null }), item('d')];
    const done = new Set(['a']);
    expect(isAutoDialEligible(queue[0]!, done)).toBe(false);
    expect(isAutoDialEligible(queue[1]!, done)).toBe(false);
    expect(isAutoDialEligible(queue[2]!, done)).toBe(false);
    expect(pickNextAutoDial(queue, -1, done, new Map(), LIMIT, NOW)).toEqual({ kind: 'dial', index: 3 });
  });

  it('phoneKey ignora máscara e o 55 do país', () => {
    expect(phoneKey('(11) 99999-0000')).toBe('11999990000');
    expect(phoneKey('5511999990000')).toBe('11999990000');
    expect(phoneKey('11999990000')).toBe('11999990000');
  });

  it('cada número: até 3 por dia e 1 h entre tentativas', () => {
    let log = recordAttempt(new Map(), '(11) 911110000', NOW);
    expect(availablePhones(two, log, LIMIT, NOW + 1000)).toEqual(['(11) 922220000']);
    expect(decideAfterNoAnswer(two, log, LIMIT, NOW + 1000)).toBe('next_number');

    log = recordAttempt(log, '(11) 922220000', NOW + 60_000);
    expect(decideAfterNoAnswer(two, log, LIMIT, NOW + 120_000)).toBe('next_lead');
    expect(availablePhones(two, log, LIMIT, NOW + AUTO_DIAL_MIN_GAP_MS)).toEqual(['(11) 911110000']);

    const full = new Map([
      ['11911110000', { count: 3, lastAt: NOW }],
      ['11922220000', { count: 3, lastAt: NOW }],
    ]);
    expect(decideAfterNoAnswer(two, full, LIMIT, NOW)).toBe('complete');
  });

  it('dá a volta na fila e espera quando ninguém está liberado', () => {
    const queue = [item('a'), item('b')];
    const log = recordAttempt(new Map(), '(11) 99999-0000', NOW);
    // a e b têm o mesmo telefone na fixture → ambos no intervalo
    expect(pickNextAutoDial(queue, 0, new Set(), log, LIMIT, NOW + 1)).toEqual({ kind: 'wait', index: 1, until: NOW + AUTO_DIAL_MIN_GAP_MS });
    expect(pickNextAutoDial(queue, 1, new Set(), new Map(), LIMIT, NOW)).toEqual({ kind: 'dial', index: 0 });
    expect(pickNextAutoDial(queue, 0, new Set(['a', 'b']), new Map(), LIMIT, NOW)).toEqual({ kind: 'none' });
  });

  it('buildAttemptLog usa a contagem do servidor', () => {
    const log = buildAttemptLog([item('a', { phoneAttempts: [{ phone: '(11) 99999-0000', attemptsToday: 2, lastAttemptAt: '2026-11-05T14:00:00Z' }] })]);
    expect(log.get('11999990000')).toEqual({ count: 2, lastAt: Date.parse('2026-11-05T14:00:00Z') });
  });

  it('countCallsByPhone junta máscaras/55 e guarda a última', () => {
    const m = countCallsByPhone([
      { destination: '5511999990000', started_at: '2026-11-05T12:00:00Z' },
      { destination: '11999990000', started_at: '2026-11-05T14:00:00Z' },
      { destination: null, started_at: '2026-11-05T15:00:00Z' },
    ]);
    expect(m.get('11999990000')).toEqual({ count: 2, last: '2026-11-05T14:00:00Z' });
    expect(m.size).toBe(1);
  });
});
