import { describe, expect, it } from 'vitest';

import { callbackShortcuts, callbackWarnings, validateCallbackAt } from './callback-slots';

/** BRT = UTC-3. 13/11/2026 é sexta. */
const brt = (iso: string) => new Date(`${iso}-03:00`);
const NOW = brt('2026-11-13T10:00:00'); // sexta 10h

const byId = (now: Date, holidays?: string[]) => Object.fromEntries(callbackShortcuts(now, holidays).map((s) => [s.id, s]));

describe('callbackShortcuts', () => {
  it('sexta 10h: em 1 hora, hoje 16h e próximo dia útil = segunda 9h', () => {
    const s = byId(NOW);
    expect(s['in-1h']?.at.toISOString()).toBe(brt('2026-11-13T11:00:00').toISOString());
    expect(s['today-16h']?.at.toISOString()).toBe(brt('2026-11-13T16:00:00').toISOString());
    expect(s['next-business-day-9h']?.at.toISOString()).toBe(brt('2026-11-16T09:00:00').toISOString());
    expect(s['next-business-day-9h']?.label).toBe('Próximo dia útil 9h');
  });

  it('terça: "Amanhã 9h" é mesmo o dia seguinte', () => {
    const s = byId(brt('2026-11-17T10:00:00'));
    expect(s['next-business-day-9h']).toMatchObject({ label: 'Amanhã 9h' });
    expect(s['next-business-day-9h']?.at.toISOString()).toBe(brt('2026-11-18T09:00:00').toISOString());
  });

  it('hoje 16h some quando falta menos de 10 min (ou já passou)', () => {
    expect(byId(brt('2026-11-13T15:51:00'))['today-16h']).toBeUndefined();
    expect(byId(brt('2026-11-13T16:00:00'))['today-16h']).toBeUndefined();
    expect(byId(brt('2026-11-13T15:50:00'))['today-16h']).toBeDefined(); // exatamente 10 min
  });

  it('depois das 20h: sem "hoje 16h"; amanhã 9h segue valendo (virada do dia em BRT, não em UTC)', () => {
    const s = byId(brt('2026-11-17T21:30:00')); // 00:30Z do dia 18
    expect(s['today-16h']).toBeUndefined();
    expect(s['next-business-day-9h']?.at.toISOString()).toBe(brt('2026-11-18T09:00:00').toISOString());
  });

  it('fim de semana: sábado e domingo caem na segunda 9h', () => {
    expect(byId(brt('2026-11-14T11:00:00'))['next-business-day-9h']?.at.toISOString()).toBe(brt('2026-11-16T09:00:00').toISOString());
    expect(byId(brt('2026-11-15T11:00:00'))['next-business-day-9h']?.at.toISOString()).toBe(brt('2026-11-16T09:00:00').toISOString());
  });

  it('feriado nacional (20/11 sexta) é pulado: quinta 19/11 -> segunda 23/11', () => {
    const s = byId(brt('2026-11-19T10:00:00'));
    expect(s['next-business-day-9h']?.at.toISOString()).toBe(brt('2026-11-23T09:00:00').toISOString());
  });

  it('feriado extra passado de fora (business_holidays) também é pulado', () => {
    const s = byId(brt('2026-11-17T10:00:00'), ['2026-11-18']);
    expect(s['next-business-day-9h']?.at.toISOString()).toBe(brt('2026-11-19T09:00:00').toISOString());
  });
});

describe('validateCallbackAt', () => {
  it('exige pelo menos 10 min de folga', () => {
    expect(validateCallbackAt(new Date(NOW.getTime() + 10 * 60_000), NOW)).toEqual({ ok: true });
    expect(validateCallbackAt(new Date(NOW.getTime() + 10 * 60_000 - 1), NOW).ok).toBe(false);
    expect(validateCallbackAt(new Date(NOW.getTime() - 60_000), NOW).ok).toBe(false);
    expect(validateCallbackAt(new Date('invalido'), NOW).ok).toBe(false);
  });
});

describe('callbackWarnings', () => {
  const ctx = { now: NOW, attemptsToday: 1 };

  it('horário útil e poucas tentativas: sem aviso', () => {
    expect(callbackWarnings(brt('2026-11-13T16:00:00'), ctx)).toEqual([]);
  });

  it('fim de semana, antes das 8h, depois das 20h ou feriado: avisa o próximo horário útil', () => {
    for (const at of ['2026-11-14T10:00:00', '2026-11-16T07:59:00', '2026-11-13T20:00:00', '2026-11-20T10:00:00']) {
      expect(callbackWarnings(brt(at), ctx), at).toHaveLength(1);
      expect(callbackWarnings(brt(at), ctx)[0]).toContain('próximo horário útil');
    }
  });

  it('3 tentativas hoje e retorno hoje: avisa que fura o intervalo mas não as 3 tentativas nem o teto', () => {
    const w = callbackWarnings(brt('2026-11-13T16:00:00'), { ...ctx, attemptsToday: 3 });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('3 tentativas hoje');
    expect(w[0]).toContain('400');
    expect(w[0]).toContain('liga amanhã');
  });

  it('3 tentativas hoje mas retorno amanhã: sem aviso de tentativas', () => {
    expect(callbackWarnings(brt('2026-11-16T09:00:00'), { ...ctx, attemptsToday: 3 })).toEqual([]);
  });

  it('os dois avisos juntos', () => {
    expect(callbackWarnings(brt('2026-11-13T21:00:00'), { ...ctx, attemptsToday: 3 })).toHaveLength(2);
  });
});
