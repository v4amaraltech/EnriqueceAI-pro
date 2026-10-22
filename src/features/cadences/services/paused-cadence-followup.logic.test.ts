import { describe, expect, it } from 'vitest';

import {
  buildFollowupNote,
  businessDaysSince,
  describePauseReason,
  minBusinessDaysFor,
  todayAt9hBrt,
} from './paused-cadence-followup.logic';

// 12/out/2026 é segunda-feira.
const at = (iso: string) => new Date(iso);

describe('businessDaysSince', () => {
  it('quinta → terça seguinte = 3 dias úteis (sex, seg, ter)', () => {
    expect(businessDaysSince(at('2026-10-08T15:00:00Z'), at('2026-10-13T12:00:00Z'))).toBe(3);
  });

  it('mesmo dia = 0', () => {
    expect(businessDaysSince(at('2026-10-12T12:00:00Z'), at('2026-10-12T20:00:00Z'))).toBe(0);
  });

  it('sexta → segunda = 1 (fim de semana não conta)', () => {
    expect(businessDaysSince(at('2026-10-09T15:00:00Z'), at('2026-10-12T12:00:00Z'))).toBe(1);
  });

  it('usa o dia BRT: 23h BRT de quinta (02h UTC de sexta) ainda é quinta', () => {
    expect(businessDaysSince(at('2026-10-09T02:00:00Z'), at('2026-10-13T12:00:00Z'))).toBe(3);
  });
});

describe('todayAt9hBrt', () => {
  it('9h BRT = 12h UTC do dia BRT corrente', () => {
    expect(todayAt9hBrt(at('2026-10-12T20:00:00Z'))).toBe('2026-10-12T12:00:00.000Z');
    // 01h UTC de terça ainda é segunda em BRT
    expect(todayAt9hBrt(at('2026-10-13T01:00:00Z'))).toBe('2026-10-12T12:00:00.000Z');
  });
});

describe('describePauseReason / buildFollowupNote', () => {
  it('traduz os motivos gravados pelo motor e pelo botão', () => {
    expect(describePauseReason('whatsapp_invalid')).toBe('número não é WhatsApp');
    expect(describePauseReason('permanent_email_error: Falha ao renovar token Gmail')).toBe('erro no envio de e-mail');
    expect(describePauseReason(null)).toBe('motivo não registrado');
    expect(describePauseReason('Pausa manual em massa')).toBe('Pausa manual em massa');
  });

  it('monta a nota com cadência e motivo', () => {
    expect(buildFollowupNote('paused', ['Recovery'], 'whatsapp_invalid')).toBe(
      'Definir destino: cadência pausada sem data de volta (Recovery — número não é WhatsApp). ' +
        'Retome a cadência, troque de cadência ou marque Ganho/Perdido.',
    );
  });
});

describe('minBusinessDaysFor', () => {
  it('respondeu = 0; bounce e pausada = 3', () => {
    expect(minBusinessDaysFor('replied')).toBe(0);
    expect(minBusinessDaysFor('bounced')).toBe(3);
    expect(minBusinessDaysFor('paused')).toBe(3);
  });
});
