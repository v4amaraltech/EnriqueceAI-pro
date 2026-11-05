import { describe, expect, it } from 'vitest';

import { buildCallOutcomePrompt, formatBrtForPrompt, nextBusinessDay9hBrt, parseCallOutcomeResponse } from './call-outcome-classifier';

// Quinta, 19/11/2026 14:00 BRT. Sexta 20/11 é feriado (Consciência Negra).
const THU_BEFORE_HOLIDAY = new Date('2026-11-19T17:00:00.000Z');

describe('parseCallOutcomeResponse', () => {
  it('JSON inválido → erro (vira ai_outcome failed)', () => {
    expect(() => parseCallOutcomeResponse('não sei', THU_BEFORE_HOLIDAY)).toThrow(/classifier_no_json/);
    expect(() => parseCallOutcomeResponse('{"disposition": "x",}', THU_BEFORE_HOLIDAY)).toThrow(/classifier_invalid_json/);
    expect(() =>
      parseCallOutcomeResponse('{"disposition":"meeting","confidence":0.9,"summary":"ok"}', THU_BEFORE_HOLIDAY),
    ).toThrow(/classifier_invalid_shape/);
    expect(() =>
      parseCallOutcomeResponse('{"disposition":"voicemail","confidence":0.9,"summary":""}', THU_BEFORE_HOLIDAY),
    ).toThrow(/classifier_invalid_shape/);
  });

  it('confiança baixa → Revisar; alta → sem selo', () => {
    const low = parseCallOutcomeResponse(
      '{"disposition":"answered_no_progress","confidence":0.55,"summary":"Atendeu e desligou."}',
      THU_BEFORE_HOLIDAY,
    );
    expect(low.needs_review).toBe(true);
    const high = parseCallOutcomeResponse(
      '```json\n{"disposition":"voicemail","confidence":0.95,"summary":"Caixa postal da operadora."}\n```',
      THU_BEFORE_HOLIDAY,
    );
    expect(high).toMatchObject({ disposition: 'voicemail', needs_review: false, callback_at: null });
  });

  it('callback sem data → próximo dia útil 9h BRT (pula feriado e fim de semana)', () => {
    const r = parseCallOutcomeResponse(
      '{"disposition":"callback_requested","confidence":0.9,"summary":"Pediu para ligar outro dia.","callback_at":null}',
      THU_BEFORE_HOLIDAY,
    );
    // Sex 20/11 feriado, 21–22 fim de semana → seg 23/11 9h BRT = 12h UTC.
    expect(r.callback_at).toBe('2026-11-23T12:00:00.000Z');
    expect(r.callback_time_from_lead).toBe(false);
  });

  it('callback com horário pedido → usa o horário (BRT)', () => {
    const r = parseCallOutcomeResponse(
      '{"disposition":"callback_requested","confidence":0.9,"summary":"Ligar amanhã 15h.","callback_at":"2026-11-23T15:00"}',
      THU_BEFORE_HOLIDAY,
    );
    expect(r.callback_at).toBe('2026-11-23T18:00:00.000Z');
    expect(r.callback_time_from_lead).toBe(true);
  });

  it('callback no passado → cai no padrão', () => {
    const r = parseCallOutcomeResponse(
      '{"disposition":"callback_requested","confidence":0.9,"summary":"x","callback_at":"2026-11-18T15:00"}',
      THU_BEFORE_HOLIDAY,
    );
    expect(r.callback_at).toBe('2026-11-23T12:00:00.000Z');
  });

  it('callback_at ignorado fora de callback_requested', () => {
    const r = parseCallOutcomeResponse(
      '{"disposition":"relevant_conversation","confidence":0.9,"summary":"x","callback_at":"2026-11-23T15:00"}',
      THU_BEFORE_HOLIDAY,
    );
    expect(r.callback_at).toBeNull();
  });

  it('resumo cortado em 3 linhas', () => {
    const r = parseCallOutcomeResponse(
      JSON.stringify({ disposition: 'relevant_conversation', confidence: 0.8, summary: 'a\nb\nc\nd' }),
      THU_BEFORE_HOLIDAY,
    );
    expect(r.summary).toBe('a\nb\nc');
  });
});

describe('helpers', () => {
  it('próximo dia útil a partir de uma segunda é a terça', () => {
    expect(nextBusinessDay9hBrt(new Date('2026-11-09T13:00:00.000Z')).toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });

  it('data/hora BRT no prompt', () => {
    expect(formatBrtForPrompt(THU_BEFORE_HOLIDAY)).toBe('2026-11-19 (quinta-feira) 14:00');
    expect(buildCallOutcomePrompt({ transcription: 'alô', durationSeconds: 42, calledAt: THU_BEFORE_HOLIDAY })).toContain(
      'Duração: 42 segundos',
    );
  });
});
