import { describe, expect, it } from 'vitest';

import {
  AUTO_DIAL_RULES,
  brtStartOfDay,
  effectiveDailyCap,
  evaluateAutoDial,
  evaluateLeadEligibility,
  isDailyCapReached,
  isLastAttemptOfDay,
  isWithinDialWindow,
  nextReleaseAt,
  type LeadDialStats,
} from './auto-dial-rules';

/** BRT = UTC-3 fixo. 13/11/2026 é sexta; 14 sábado; 15 domingo (feriado); 16 segunda; 20/11 sexta (feriado). */
const brt = (iso: string) => new Date(`${iso}-03:00`);

const freshLead = (over: Partial<LeadDialStats> = {}): LeadDialStats => ({
  callsToday: 0,
  lastCallAt: null,
  conversationToday: false,
  holdTypes: [],
  ...over,
});

describe('isWithinDialWindow (FR-11)', () => {
  const cases: Array<[string, string, 'ok' | 'outside_hours' | 'holiday']> = [
    ['sexta 07:59:59', '2026-11-13T07:59:59', 'outside_hours'],
    ['sexta 08:00:00', '2026-11-13T08:00:00', 'ok'],
    ['sexta 19:59:59', '2026-11-13T19:59:59', 'ok'],
    ['sexta 19:59:59.999', '2026-11-13T19:59:59.999', 'ok'],
    ['sexta 20:00:00', '2026-11-13T20:00:00', 'outside_hours'],
    ['sexta 23:59:59', '2026-11-13T23:59:59', 'outside_hours'],
    ['segunda 12:00', '2026-11-16T12:00:00', 'ok'],
    ['sábado 12:00', '2026-11-14T12:00:00', 'outside_hours'],
    ['domingo 12:00', '2026-11-15T12:00:00', 'outside_hours'],
    ['feriado (20/11, sexta) 12:00', '2026-11-20T12:00:00', 'holiday'],
    ['feriado (20/11, sexta) 21:00', '2026-11-20T21:00:00', 'holiday'],
  ];
  it.each(cases)('%s', (_name, iso, expected) => {
    const r = isWithinDialWindow(brt(iso));
    if (expected === 'ok') expect(r).toEqual({ allowed: true });
    else expect(r).toMatchObject({ allowed: false, code: expected });
  });

  it('usa a lista de feriados recebida por parâmetro (Set ou array), sem consultar banco', () => {
    expect(isWithinDialWindow(brt('2026-11-16T12:00:00'), ['2026-11-16'])).toMatchObject({ allowed: false, code: 'holiday' });
    expect(isWithinDialWindow(brt('2026-11-16T12:00:00'), new Set(['2026-11-16']))).toMatchObject({ allowed: false, code: 'holiday' });
    expect(isWithinDialWindow(brt('2026-11-20T12:00:00'), [])).toEqual({ allowed: true });
  });

  it('o dia é o de Brasília: 22:59:59Z de sexta ainda é 19:59:59 BRT; 23:00:00Z já é 20:00 BRT', () => {
    expect(isWithinDialWindow(new Date('2026-11-13T22:59:59Z'))).toEqual({ allowed: true });
    expect(isWithinDialWindow(new Date('2026-11-13T23:00:00Z'))).toMatchObject({ allowed: false, code: 'outside_hours' });
    // 02:00Z de sábado = 23:00 BRT de sexta (não é sábado em Brasília)
    expect(isWithinDialWindow(new Date('2026-11-14T02:00:00Z'))).toMatchObject({ allowed: false, code: 'outside_hours' });
    // 12:00Z de segunda = 09:00 BRT de segunda
    expect(isWithinDialWindow(new Date('2026-11-16T12:00:00Z'))).toEqual({ allowed: true });
  });

  it('a recusa traz mensagem em português', () => {
    const r = isWithinDialWindow(brt('2026-11-14T10:00:00'));
    expect(r.allowed === false && r.message).toContain('Fora do horário');
  });
});

describe('teto diário do motor (FR-12)', () => {
  it('399 libera, 400 bloqueia (teto de 400 desde o início, M-6)', () => {
    expect(isDailyCapReached(99)).toBe(false);
    expect(isDailyCapReached(100)).toBe(false);
    expect(isDailyCapReached(399)).toBe(false);
    expect(isDailyCapReached(400)).toBe(true);
    expect(isDailyCapReached(500)).toBe(true);
  });
  it('é parametrizável e nunca passa de 400', () => {
    expect(isDailyCapReached(399, { dailyCap: 400, dailyCapMax: 400 })).toBe(false);
    expect(isDailyCapReached(400, { dailyCap: 400, dailyCapMax: 400 })).toBe(true);
    expect(effectiveDailyCap({ dailyCap: 900, dailyCapMax: 400 })).toBe(400);
    expect(isDailyCapReached(400, { dailyCap: 900, dailyCapMax: 400 })).toBe(true);
  });
});

describe('elegibilidade do lead (FR-4, FR-5, FR-9b, FR-10)', () => {
  const now = brt('2026-11-13T12:00:00');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it('1ª tentativa do dia: livre', () => {
    expect(evaluateLeadEligibility(freshLead(), now)).toEqual({ allowed: true });
  });

  const attempts: Array<[string, number, number | null, 'ok' | 'attempts' | 'gap']> = [
    ['2ª tentativa, última há 60 min', 1, 60, 'ok'],
    ['3ª tentativa, última há 120 min', 2, 120, 'ok'],
    ['4ª tentativa (3 já feitas), última há 600 min', 3, 600, 'attempts'],
    ['5ª tentativa (4 já feitas)', 4, 600, 'attempts'],
    ['intervalo 59 min', 1, 59, 'gap'],
    ['intervalo 60 min', 1, 60, 'ok'],
    ['intervalo 61 min', 1, 61, 'ok'],
    ['intervalo 0 min (agora)', 1, 0, 'gap'],
    ['3 feitas e intervalo curto: tentativas vence', 3, 5, 'attempts'],
  ];
  it.each(attempts)('%s', (_n, callsToday, minutesAgo, expected) => {
    const r = evaluateLeadEligibility(freshLead({ callsToday, lastCallAt: minutesAgo === null ? null : ago(minutesAgo) }), now);
    if (expected === 'ok') expect(r).toEqual({ allowed: true });
    else expect(r).toMatchObject({ allowed: false, code: expected });
  });

  it('gap devolve quando o lead fica liberado', () => {
    const r = evaluateLeadEligibility(freshLead({ callsToday: 1, lastCallAt: ago(10) }), now);
    expect(r).toMatchObject({ allowed: false, code: 'gap', releaseAt: ago(10).getTime() + 3_600_000 });
  });

  it('aceita lastCallAt em ISO e em ms', () => {
    expect(evaluateLeadEligibility(freshLead({ callsToday: 1, lastCallAt: ago(30).toISOString() }), now)).toMatchObject({ code: 'gap' });
    expect(evaluateLeadEligibility(freshLead({ callsToday: 1, lastCallAt: ago(90).getTime() }), now)).toEqual({ allowed: true });
  });

  it('conversa real hoje sai do motor (answered_today), mesmo com poucas tentativas', () => {
    expect(evaluateLeadEligibility(freshLead({ callsToday: 1, lastCallAt: ago(500), conversationToday: true }), now)).toMatchObject({
      allowed: false,
      code: 'answered_today',
    });
  });

  it('bloqueio total ou prospeccao recusa; conversa não', () => {
    expect(evaluateLeadEligibility(freshLead({ holdTypes: ['total'] }), now)).toMatchObject({ code: 'held' });
    expect(evaluateLeadEligibility(freshLead({ holdTypes: ['prospeccao'] }), now)).toMatchObject({ code: 'held' });
    expect(evaluateLeadEligibility(freshLead({ holdTypes: ['conversa'] }), now)).toEqual({ allowed: true });
  });

  it('o bloqueio vem antes dos demais motivos', () => {
    expect(evaluateLeadEligibility(freshLead({ holdTypes: ['total'], conversationToday: true, callsToday: 3 }), now)).toMatchObject({ code: 'held' });
  });
});

describe('evaluateAutoDial: ordem das recusas', () => {
  const open = brt('2026-11-13T12:00:00');
  it('tudo livre', () => {
    expect(evaluateAutoDial({ now: open, motorCallsToday: 0, lead: freshLead() })).toEqual({ allowed: true });
  });
  it('janela vence o teto e o lead', () => {
    expect(evaluateAutoDial({ now: brt('2026-11-13T20:00:00'), motorCallsToday: 500, lead: freshLead({ holdTypes: ['total'] }) })).toMatchObject({
      code: 'outside_hours',
    });
    expect(evaluateAutoDial({ now: brt('2026-11-20T12:00:00'), motorCallsToday: 500, lead: freshLead() })).toMatchObject({ code: 'holiday' });
  });
  it('teto vence o lead', () => {
    expect(evaluateAutoDial({ now: open, motorCallsToday: 400, lead: freshLead({ holdTypes: ['total'] }) })).toMatchObject({ code: 'daily_cap' });
  });
  it('lead por último', () => {
    expect(evaluateAutoDial({ now: open, motorCallsToday: 99, lead: freshLead({ callsToday: 3 }) })).toMatchObject({ code: 'attempts' });
  });
  it('feriados por parâmetro chegam até a decisão', () => {
    expect(evaluateAutoDial({ now: open, motorCallsToday: 0, lead: freshLead(), holidays: ['2026-11-13'] })).toMatchObject({ code: 'holiday' });
  });
  it('mesma entrada, mesma saída', () => {
    const input = { now: open, motorCallsToday: 10, lead: freshLead({ callsToday: 1, lastCallAt: brt('2026-11-13T11:30:00') }) };
    expect(evaluateAutoDial(input)).toEqual(evaluateAutoDial(input));
  });
});

describe('nextReleaseAt (estado Aguardando)', () => {
  const now = brt('2026-11-13T12:00:00');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it('devolve o menor horário entre os que só esperam o intervalo', () => {
    const r = nextReleaseAt(
      [
        freshLead({ callsToday: 1, lastCallAt: ago(10) }),
        freshLead({ callsToday: 1, lastCallAt: ago(40) }),
        freshLead({ callsToday: 3, lastCallAt: ago(1) }), // esgotado: não conta
        freshLead({ holdTypes: ['total'] }), // bloqueado: não conta
      ],
      now,
    );
    expect(r).toBe(ago(40).getTime() + 3_600_000);
  });
  it('null quando ninguém espera só pelo intervalo', () => {
    expect(nextReleaseAt([freshLead({ callsToday: 3 })], now)).toBeNull();
    expect(nextReleaseAt([], now)).toBeNull();
  });
});

describe('isLastAttemptOfDay (FR-6/FR-7)', () => {
  it.each([
    [1, false],
    [2, false],
    [3, true],
    [4, true],
  ])('tentativa %i', (n, last) => expect(isLastAttemptOfDay(n)).toBe(last));
});

describe('brtStartOfDay', () => {
  it('é 00:00 de Brasília do dia (03:00Z)', () => {
    expect(new Date(brtStartOfDay(new Date('2026-11-13T22:59:59Z'))).toISOString()).toBe('2026-11-13T03:00:00.000Z');
    // 02:00Z ainda é o dia anterior em Brasília
    expect(new Date(brtStartOfDay(new Date('2026-11-14T02:00:00Z'))).toISOString()).toBe('2026-11-13T03:00:00.000Z');
    expect(new Date(brtStartOfDay(new Date('2026-11-14T03:00:00Z'))).toISOString()).toBe('2026-11-14T03:00:00.000Z');
  });
});

describe('constantes', () => {
  it('batem com as decisões do usuário', () => {
    expect(AUTO_DIAL_RULES).toMatchObject({ maxAttemptsPerDay: 3, minGapMs: 3_600_000, dailyCap: 400, dailyCapMax: 400, windowStartHour: 8, windowEndHour: 20 });
    expect([...AUTO_DIAL_RULES.blockedHoldTypes]).toEqual(['total', 'prospeccao']);
  });
});
