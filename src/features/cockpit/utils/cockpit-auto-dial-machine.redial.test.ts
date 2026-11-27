import { describe, expect, it } from 'vitest';

import { noAnswerEvent, reduceCockpitAutoDial, type CockpitAutoDialEvent, type CockpitAutoDialState } from './cockpit-auto-dial-machine';

const run = (state: CockpitAutoDialState, ...events: CockpitAutoDialEvent[]) => events.reduce(reduceCockpitAutoDial, state);
const answered: CockpitAutoDialState = { phase: 'awaiting-sdr', reason: 'answered' };
const inCall = () => run(answered, { type: 'redial' }, { type: 'awaiting_session' }, { type: 'session_confirmed' });

describe('máquina: "Ligar de novo"', () => {
  it('só sai da tela de desfecho', () => {
    expect(run(answered, { type: 'redial' })).toEqual({ phase: 'dialing', redialFrom: 'answered' });
    const countdown: CockpitAutoDialState = { phase: 'countdown', secondsLeft: 3 };
    expect(run(countdown, { type: 'redial' })).toBe(countdown);
  });

  it('atendida e conversou: desfecho na ligação nova', () => {
    expect(run(inCall(), { type: 'call_ended' }, { type: 'lead_answer', answer: 'answered' })).toEqual({ phase: 'awaiting-sdr', reason: 'answered', redial: 'conversed' });
  });

  it('não atendeu (mesmo na 3ª tentativa) e sem resultado: volta ao desfecho, nunca grava nem avança', () => {
    for (const attempt of [1, 3, 7]) {
      expect(run(inCall(), { type: 'call_ended' }, noAnswerEvent(attempt))).toMatchObject({ phase: 'awaiting-sdr', reason: 'answered', redial: 'not_answered' });
    }
    expect(run(inCall(), { type: 'call_ended' }, { type: 'answer_timeout' })).toMatchObject({ phase: 'awaiting-sdr', redial: 'unknown' });
    const timeout: CockpitAutoDialState = { phase: 'awaiting-sdr', reason: 'timeout' };
    expect(run(timeout, { type: 'redial' }, { type: 'dial_failed', message: 'x' })).toEqual({ phase: 'awaiting-sdr', reason: 'timeout', redial: 'failed', redialError: 'x' });
  });

  it('falha, sessão que não entrou, ocupado e bloqueio: continua no desfecho', () => {
    const dialing = run(answered, { type: 'redial' });
    expect(run(dialing, { type: 'awaiting_session' }, { type: 'session_missing', message: 'm' })).toMatchObject({ phase: 'awaiting-sdr', redial: 'failed', redialError: 'm' });
    expect(run(dialing, { type: 'ramal_busy', until: 1 })).toBe(dialing);
    expect(run(dialing, { type: 'blocked', reason: 'daily_cap' })).toBe(dialing);
    expect(run(dialing, { type: 'next_lead' })).toBe(dialing);
  });

  it('Parar desliga; conclusão pelo painel com a ligação no ar espera ela terminar; depois do desfecho a marca some', () => {
    expect(run(inCall(), { type: 'stop' })).toEqual({ phase: 'off' });
    expect(run(inCall(), { type: 'concluded_externally' })).toEqual({ phase: 'concluded-call' });
    const done = run(inCall(), { type: 'call_ended' }, noAnswerEvent(1), { type: 'sdr_concluded' });
    expect(done).toEqual({ phase: 'countdown', secondsLeft: 5 });
  });
});
