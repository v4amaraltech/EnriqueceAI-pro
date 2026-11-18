import { describe, expect, it } from 'vitest';

import { AUTO_DIAL_COUNTDOWN_SECONDS } from '@/features/activities/utils/auto-dialer';

import {
  describeCockpitAutoDial,
  isCallInProgress,
  isCockpitAutoDialOn,
  reduceCockpitAutoDial,
  type CockpitAutoDialEvent,
  type CockpitAutoDialState,
} from './cockpit-auto-dial-machine';

const run = (events: CockpitAutoDialEvent[], from: CockpitAutoDialState): CockpitAutoDialState => events.reduce(reduceCockpitAutoDial, from);
const countdown = { phase: 'countdown', secondsLeft: AUTO_DIAL_COUNTDOWN_SECONDS } as const;
const concludedCall = { phase: 'concluded-call' } as const;
const concluded: CockpitAutoDialEvent = { type: 'concluded_externally' };

describe('conclusão pelo painel (Agendar / Desqualificar)', () => {
  it.each([
    ['awaiting-session', { phase: 'awaiting-session' }],
    ['in-call', { phase: 'in-call' }],
  ] as Array<[string, CockpitAutoDialState]>)('ligação no ar (%s): NÃO segue ainda e NÃO derruba; espera terminar', (_n, from) => {
    expect(run([concluded], from)).toEqual(concludedCall);
  });

  it.each([
    ['conferindo atendimento', { phase: 'resolving' }],
    ['aguardando desfecho (atendeu)', { phase: 'awaiting-sdr', reason: 'answered' }],
    ['aguardando desfecho (sem sinal)', { phase: 'awaiting-sdr', reason: 'timeout' }],
    ['registrando', { phase: 'auto-completing', outcome: 'no_answer' }],
  ] as Array<[string, CockpitAutoDialState]>)('ligação já terminou (%s): conclui e segue para o próximo, sem Confirmar', (_n, from) => {
    expect(run([concluded], from)).toEqual(countdown);
  });

  it.each([
    ['desligado', { phase: 'off' }],
    ['contagem', countdown],
    ['discando', { phase: 'dialing' }],
    ['liberando ramal', { phase: 'releasing', until: 1 }],
    ['aguardando', { phase: 'waiting', until: 1 }],
    ['pausado', { phase: 'paused', reason: 'user', message: null }],
    ['bloqueado', { phase: 'blocked', reason: 'daily_cap' }],
  ] as Array<[string, CockpitAutoDialState]>)('fora de uma ligação (%s): ignorada', (_n, from) => {
    expect(run([concluded], from)).toEqual(from);
  });

  it('com a ligação no ar, o fim dela leva direto ao próximo lead (sem conferir atendimento nem pedir o Confirmar)', () => {
    expect(run([{ type: 'call_ended' }], concludedCall)).toEqual(countdown);
  });

  it('eventos atrasados da ligação já concluída são ignorados', () => {
    const late: CockpitAutoDialEvent[] = [
      { type: 'tick' },
      { type: 'lead_answer', answer: 'answered' },
      { type: 'lead_answer', answer: 'not_answered' },
      { type: 'answer_timeout' },
      { type: 'session_confirmed' },
      { type: 'session_missing', message: 'x' },
      { type: 'dial_failed', message: 'x' },
      { type: 'completed' },
      { type: 'sdr_concluded' },
      { type: 'wake' },
      { type: 'resume' },
      { type: 'pause', reason: 'user' },
      { type: 'blocked', reason: 'holiday' },
    ];
    expect(run(late, concludedCall)).toEqual(concludedCall);
  });

  it('depois de concluído e seguido, eventos atrasados do lead antigo não mexem no próximo (contagem os ignora)', () => {
    const afterEnd = run([{ type: 'call_ended' }], concludedCall);
    expect(run([{ type: 'lead_answer', answer: 'answered' }, { type: 'sdr_concluded' }, { type: 'call_ended' }], afterEnd)).toEqual(afterEnd);
  });

  it('conclusão repetida é idempotente', () => {
    expect(run([concluded, concluded], { phase: 'in-call' })).toEqual(concludedCall);
    expect(run([concluded, concluded], { phase: 'awaiting-sdr', reason: 'answered' })).toEqual(countdown);
  });

  it('Parar de dentro de concluded-call volta a Desligado (e nada derruba a ligação: o redutor só muda o estado)', () => {
    expect(run([{ type: 'stop' }], concludedCall)).toEqual({ phase: 'off' });
  });

  it('a ligação segue "em curso" para a tela e o motor está ligado', () => {
    expect(isCallInProgress(concludedCall)).toBe(true);
    expect(isCockpitAutoDialOn(concludedCall)).toBe(true);
    expect(describeCockpitAutoDial(concludedCall)).toBe('Lead concluído pelo painel: a discagem segue quando a ligação terminar');
  });
});
