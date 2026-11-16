import { describe, expect, it } from 'vitest';

import { evaluateLeadEligibility, type LeadDialStats } from './auto-dial-rules';

const NOW = new Date('2026-11-13T15:00:00Z');
const stats = (over: Partial<LeadDialStats> = {}): LeadDialStats => ({ callsToday: 1, lastCallAt: new Date(NOW.getTime() - 10 * 60_000), conversationToday: false, holdTypes: [], ...over });

describe('callbackDue (retorno vencido, FR-23)', () => {
  it('sem retorno: o intervalo de 1 h e a conversa de hoje recusam', () => {
    expect(evaluateLeadEligibility(stats(), NOW)).toMatchObject({ allowed: false, code: 'gap' });
    expect(evaluateLeadEligibility(stats({ conversationToday: true }), NOW)).toMatchObject({ allowed: false, code: 'answered_today' });
  });
  it('com retorno: fura o intervalo e a conversa de hoje', () => {
    expect(evaluateLeadEligibility(stats({ callbackDue: true }), NOW)).toEqual({ allowed: true });
    expect(evaluateLeadEligibility(stats({ callbackDue: true, conversationToday: true }), NOW)).toEqual({ allowed: true });
  });
  it('com retorno: NÃO fura bloqueio nem as 3 tentativas', () => {
    expect(evaluateLeadEligibility(stats({ callbackDue: true, holdTypes: ['total'] }), NOW)).toMatchObject({ code: 'held' });
    expect(evaluateLeadEligibility(stats({ callbackDue: true, holdTypes: ['prospeccao'] }), NOW)).toMatchObject({ code: 'held' });
    expect(evaluateLeadEligibility(stats({ callbackDue: true, callsToday: 3 }), NOW)).toMatchObject({ code: 'attempts' });
  });
});
