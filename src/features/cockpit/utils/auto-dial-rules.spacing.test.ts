import { describe, expect, it } from 'vitest';

import { DIAL_SPACING, evaluateDialSpacing, type RecentUserCall } from './auto-dial-rules';

const NOW = new Date('2026-11-13T15:00:00Z');
const agoSec = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
const call = (over: Partial<RecentUserCall> = {}): RecentUserCall => ({ created_at: agoSec(600), hangup_cause: 'NORMAL_CLEARING', isMotor: true, ...over });

describe('evaluateDialSpacing (trava suave contra disparo duplo)', () => {
  it('sem ligações recentes: livre', () => {
    expect(evaluateDialSpacing([], NOW)).toEqual({ allowed: true });
    expect(evaluateDialSpacing([call()], NOW)).toEqual({ allowed: true });
  });

  it('ligação criada há menos de 20 s, de QUALQUER origem (marcada ou não, terminada ou não): too_soon', () => {
    for (const over of [{ isMotor: true }, { isMotor: false }, { hangup_cause: null }, { hangup_cause: 'NORMAL_CLEARING' }]) {
      expect(evaluateDialSpacing([call({ created_at: agoSec(5), ...over })], NOW), JSON.stringify(over)).toMatchObject({ allowed: false, code: 'too_soon' });
    }
  });

  it('fronteira dos 20 s: 19,9 s recusa; 20 s libera', () => {
    expect(evaluateDialSpacing([call({ created_at: agoSec(19.9) })], NOW)).toMatchObject({ code: 'too_soon' });
    expect(evaluateDialSpacing([call({ created_at: agoSec(20) })], NOW)).toEqual({ allowed: true });
  });

  it('ligação do MOTOR ainda sem término (hangup_cause vazio) nos últimos 20 min: too_soon', () => {
    expect(evaluateDialSpacing([call({ created_at: agoSec(120), hangup_cause: null })], NOW)).toMatchObject({ code: 'too_soon' });
    expect(evaluateDialSpacing([call({ created_at: agoSec(19 * 60), hangup_cause: null })], NOW)).toMatchObject({ code: 'too_soon' });
  });

  it('sem término mas ANTIGA (20 min ou mais) não trava para sempre; sem término e NÃO do motor (>20 s) não trava', () => {
    expect(evaluateDialSpacing([call({ created_at: agoSec(20 * 60), hangup_cause: null })], NOW)).toEqual({ allowed: true });
    expect(evaluateDialSpacing([call({ created_at: agoSec(120), hangup_cause: null, isMotor: false })], NOW)).toEqual({ allowed: true });
  });

  it('ligação do motor já terminada (com hangup_cause) e com mais de 20 s: libera', () => {
    expect(evaluateDialSpacing([call({ created_at: agoSec(30) })], NOW)).toEqual({ allowed: true });
  });

  it('basta UMA recusa entre várias; constantes', () => {
    expect(evaluateDialSpacing([call(), call({ created_at: agoSec(3) })], NOW)).toMatchObject({ code: 'too_soon' });
    expect(DIAL_SPACING).toEqual({ minSinceLastCallMs: 20_000, ongoingMaxAgeMs: 1_200_000 });
  });

  it('aceita created_at em Date, ms e ISO; mensagem em português', () => {
    expect(evaluateDialSpacing([call({ created_at: new Date(NOW.getTime() - 5000) })], NOW)).toMatchObject({ code: 'too_soon' });
    expect(evaluateDialSpacing([call({ created_at: NOW.getTime() - 5000 })], NOW)).toMatchObject({ code: 'too_soon' });
    const r = evaluateDialSpacing([call({ created_at: agoSec(1) })], NOW);
    expect(r.allowed === false && r.message).toContain('ligação');
  });
});
