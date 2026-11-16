import { describe, expect, it } from 'vitest';

import { SIMULATED_CALL_DURATION_MS, resolveSimulatedOutcome, simulateDial } from './simulated-dialer';

describe('simulateDial', () => {
  it('atendeu: ligação fictícia que termina atendida, com id determinístico', () => {
    expect(simulateDial({ leadId: 'L1', attemptNo: 1, script: 'answered' })).toEqual({
      kind: 'started',
      simulated: true,
      callId: 'sim-L1-1',
      answered: true,
      endsAfterMs: SIMULATED_CALL_DURATION_MS,
    });
  });

  it('não atendeu: ligação fictícia sem atendimento', () => {
    expect(simulateDial({ leadId: 'L1', attemptNo: 2, script: 'no_answer' })).toMatchObject({ kind: 'started', answered: false, callId: 'sim-L1-2' });
  });

  it('424 simulado: pede espera de 15 s e nova tentativa', () => {
    expect(simulateDial({ leadId: 'L1', attemptNo: 1, script: 'ramal_busy' })).toEqual({ kind: 'ramal_busy', simulated: true, retryAfterMs: 15_000 });
  });

  it('erro simulado: falha com mensagem', () => {
    expect(simulateDial({ leadId: 'L1', attemptNo: 1, script: 'dial_failed' })).toMatchObject({ kind: 'failed', simulated: true });
  });

  it('é determinístico: mesma entrada, mesma saída', () => {
    const input = { leadId: 'L9', attemptNo: 3, script: ['no_answer', 'answered'] as const };
    expect(simulateDial(input)).toEqual(simulateDial(input));
  });

  it('o id simulado nunca parece um id real (prefixo sim-)', () => {
    const r = simulateDial({ leadId: 'L1', attemptNo: 1, script: 'answered' });
    expect(r.kind === 'started' && r.callId.startsWith('sim-')).toBe(true);
  });
});

describe('resolveSimulatedOutcome (roteiro)', () => {
  it('lista cicla pela tentativa', () => {
    const script = ['no_answer', 'no_answer', 'answered'] as const;
    expect([1, 2, 3, 4, 5, 6].map((n) => resolveSimulatedOutcome(script, 'L', n))).toEqual([
      'no_answer',
      'no_answer',
      'answered',
      'no_answer',
      'no_answer',
      'answered',
    ]);
  });

  it('mapa por lead, com padrão "*" e padrão final no_answer', () => {
    const script = { A: 'answered', B: ['dial_failed', 'no_answer'], '*': 'no_answer' } as const;
    expect(resolveSimulatedOutcome(script, 'A', 1)).toBe('answered');
    expect(resolveSimulatedOutcome(script, 'B', 1)).toBe('dial_failed');
    expect(resolveSimulatedOutcome(script, 'B', 2)).toBe('no_answer');
    expect(resolveSimulatedOutcome(script, 'Z', 1)).toBe('no_answer');
    expect(resolveSimulatedOutcome({ A: 'answered' }, 'Z', 1)).toBe('no_answer');
  });

  it('lista vazia e tentativa inválida não quebram', () => {
    expect(resolveSimulatedOutcome([], 'L', 1)).toBe('no_answer');
    expect(resolveSimulatedOutcome(['answered'], 'L', 0)).toBe('answered');
    expect(resolveSimulatedOutcome(['no_answer', 'answered'], 'L', -3)).toBe('no_answer');
  });
});
