import { describe, expect, it } from 'vitest';

import {
  MAX_DAILY_LIMIT,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  START_DAILY_LIMIT,
  brtDayStartIso,
  businessDaysAfter,
  canSendNow,
  invalidRateTripped,
  isInSendWindow,
  isInvalidNumberError,
  limitAfterIncident,
  nextIntervalMs,
  stripUnresolvedVars,
  typingDelayMs,
  warmUpDailyLimit,
} from './pacing';

// 2026-11-09 é segunda-feira. 13:00Z = 10:00 BRT.
const MON_10H = new Date('2026-11-09T13:00:00Z');

describe('isInSendWindow', () => {
  it('aceita dia útil entre 8h e 18h BRT', () => {
    expect(isInSendWindow(MON_10H)).toBe(true);
    expect(isInSendWindow(new Date('2026-11-09T11:00:00Z'))).toBe(true); // 8h00
    expect(isInSendWindow(new Date('2026-11-09T20:59:00Z'))).toBe(true); // 17h59
  });

  it('recusa antes das 8h e a partir das 18h BRT', () => {
    expect(isInSendWindow(new Date('2026-11-09T10:59:00Z'))).toBe(false); // 7h59
    expect(isInSendWindow(new Date('2026-11-09T21:00:00Z'))).toBe(false); // 18h00
  });

  it('recusa fim de semana e feriado nacional', () => {
    expect(isInSendWindow(new Date('2026-11-07T13:00:00Z'))).toBe(false); // sábado
    expect(isInSendWindow(new Date('2026-11-08T13:00:00Z'))).toBe(false); // domingo
    expect(isInSendWindow(new Date('2026-11-20T13:00:00Z'))).toBe(false); // Consciência Negra (sexta)
  });

  it('usa o dia BRT, não o UTC (01h UTC de terça = 22h de segunda)', () => {
    expect(isInSendWindow(new Date('2026-11-10T01:00:00Z'))).toBe(false);
  });
});

describe('brtDayStartIso', () => {
  it('devolve a meia-noite BRT em UTC', () => {
    expect(brtDayStartIso(MON_10H)).toBe('2026-11-09T03:00:00.000Z');
    // 01h UTC de terça ainda é segunda em BRT
    expect(brtDayStartIso(new Date('2026-11-10T01:00:00Z'))).toBe('2026-11-09T03:00:00.000Z');
  });
});

describe('businessDaysAfter', () => {
  it('conta só dias úteis depois da data inicial', () => {
    expect(businessDaysAfter('2026-11-09', '2026-11-09')).toBe(0);
    expect(businessDaysAfter('2026-11-09', '2026-11-12')).toBe(3); // ter, qua, qui
    expect(businessDaysAfter('2026-11-06', '2026-11-09')).toBe(1); // sáb e dom não contam
    expect(businessDaysAfter('2026-11-18', '2026-11-23')).toBe(2); // qui 19, (sex 20 feriado), seg 23
  });
});

describe('warmUpDailyLimit (critério 9)', () => {
  it('número que nunca passou pelo aquecimento começa a contar hoje', () => {
    expect(warmUpDailyLimit({ limit: START_DAILY_LIMIT, changedOn: null }, '2026-11-09')).toEqual({
      limit: 20,
      changedOn: '2026-11-09',
      changed: true,
    });
  });

  it('não sobe antes de 3 dias úteis', () => {
    expect(warmUpDailyLimit({ limit: 20, changedOn: '2026-11-09' }, '2026-11-11')).toEqual({
      limit: 20,
      changedOn: '2026-11-09',
      changed: false,
    });
  });

  it('sobe +10 depois de 3 dias úteis e reinicia a contagem', () => {
    expect(warmUpDailyLimit({ limit: 20, changedOn: '2026-11-09' }, '2026-11-12')).toEqual({
      limit: 30,
      changedOn: '2026-11-12',
      changed: true,
    });
  });

  it('para no teto de 80', () => {
    expect(warmUpDailyLimit({ limit: 75, changedOn: '2026-11-02' }, '2026-11-12').limit).toBe(MAX_DAILY_LIMIT);
    expect(warmUpDailyLimit({ limit: 80, changedOn: '2026-10-01' }, '2026-11-12')).toMatchObject({
      limit: 80,
      changed: false,
    });
  });
});

describe('limitAfterIncident', () => {
  it('volta um degrau sem passar do mínimo', () => {
    expect(limitAfterIncident(50)).toBe(40);
    expect(limitAfterIncident(25)).toBe(20);
    expect(limitAfterIncident(20)).toBe(20);
  });
});

describe('nextIntervalMs / typingDelayMs (critério 4)', () => {
  it('fica sempre entre 2 e 6 minutos', () => {
    expect(nextIntervalMs(() => 0)).toBe(MIN_INTERVAL_MS);
    expect(nextIntervalMs(() => 0.999999)).toBeLessThanOrEqual(MAX_INTERVAL_MS);
    for (let i = 0; i < 200; i++) {
      const v = nextIntervalMs();
      expect(v).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
      expect(v).toBeLessThanOrEqual(MAX_INTERVAL_MS);
    }
  });

  it('"digitando…" entre 3 e 8 segundos', () => {
    expect(typingDelayMs(() => 0)).toBe(3_000);
    expect(typingDelayMs(() => 1)).toBe(8_000);
  });
});

describe('canSendNow', () => {
  const base = {
    now: MON_10H,
    pausedAt: null,
    nextAt: null,
    sentTodayCounted: 0,
    dailyLimit: 20,
    countsTowardLimit: true,
  };

  it('libera quando tudo está ok', () => {
    expect(canSendNow(base)).toEqual({ ok: true });
  });

  it('bloqueia fora da janela (critério 4)', () => {
    expect(canSendNow({ ...base, now: new Date('2026-11-07T13:00:00Z') })).toEqual({ ok: false, reason: 'outside_window' });
  });

  it('bloqueia número pausado (critério 6)', () => {
    expect(canSendNow({ ...base, pausedAt: '2026-11-09T12:00:00Z' })).toEqual({ ok: false, reason: 'paused' });
  });

  it('respeita o intervalo até o próximo envio (critério 4)', () => {
    expect(canSendNow({ ...base, nextAt: '2026-11-09T13:03:00Z' })).toEqual({ ok: false, reason: 'interval' });
    expect(canSendNow({ ...base, nextAt: '2026-11-09T12:59:00Z' })).toEqual({ ok: true });
  });

  it('para no limite diário de contatos novos (critério 3)', () => {
    expect(canSendNow({ ...base, sentTodayCounted: 20 })).toEqual({ ok: false, reason: 'daily_limit' });
    expect(canSendNow({ ...base, sentTodayCounted: 19 })).toEqual({ ok: true });
  });

  it('lead que já respondeu não conta no limite (critério 3)', () => {
    expect(canSendNow({ ...base, sentTodayCounted: 20, countsTowardLimit: false })).toEqual({ ok: true });
  });
});

describe('invalidRateTripped (critério 6)', () => {
  it('não dispara com menos de 5 tentativas', () => {
    expect(invalidRateTripped(4, 4)).toBe(false);
  });

  it('dispara acima de 20%', () => {
    expect(invalidRateTripped(5, 1)).toBe(false); // 20% exato
    expect(invalidRateTripped(5, 2)).toBe(true);
    expect(invalidRateTripped(10, 3)).toBe(true);
  });
});

describe('isInvalidNumberError', () => {
  it('reconhece as mensagens da Evolution para destino sem WhatsApp', () => {
    expect(isInvalidNumberError('Esse número não está cadastrado no WhatsApp')).toBe(true);
    expect(isInvalidNumberError('Número de telefone inválido')).toBe(true);
    expect(isInvalidNumberError('Evolution API error: 500')).toBe(false);
    expect(isInvalidNumberError(undefined)).toBe(false);
  });
});

describe('stripUnresolvedVars', () => {
  it('remove variáveis não preenchidas e preserva quebras de linha', () => {
    expect(stripUnresolvedVars('Oi {{primeiro_nome}}, tudo bem?\n\nSou da {{empresa}}.')).toBe('Oi , tudo bem?\n\nSou da .');
    expect(stripUnresolvedVars('a\n\n\n\nb')).toBe('a\n\nb');
  });
});
