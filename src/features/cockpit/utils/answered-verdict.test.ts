import { describe, expect, it } from 'vitest';

import {
  AMD_MACHINE_MIN_CONFIDENCE,
  ANSWERED_MIN_TALK_SECONDS,
  extractAmd,
  getAnsweredVerdict,
  type AnsweredVerdictInput,
} from './answered-verdict';

const AT = '2026-11-16T15:00:00Z';
const input = (over: Partial<AnsweredVerdictInput> = {}): AnsweredVerdictInput => ({
  answeredAt: AT,
  durationSeconds: null,
  amdPrediction: null,
  amdConfidence: null,
  ...over,
});

describe('limiares', () => {
  it('10 s e 0,85', () => {
    expect(ANSWERED_MIN_TALK_SECONDS).toBe(10);
    expect(AMD_MACHINE_MIN_CONFIDENCE).toBe(0.85);
  });
});

describe('getAnsweredVerdict (tabela de casos)', () => {
  const cases: Array<[string, Partial<AnsweredVerdictInput>, 'conversou' | 'nao_conversou', string]> = [
    ['sem answered_at (null)', { answeredAt: null, durationSeconds: 120 }, 'nao_conversou', 'not_answered'],
    ['sem answered_at (vazio)', { answeredAt: '  ', durationSeconds: 120, amdPrediction: 'human', amdConfidence: 0.99 }, 'nao_conversou', 'not_answered'],
    ['voicemail 0,9', { amdPrediction: 'voicemail', amdConfidence: 0.9, durationSeconds: 5 }, 'nao_conversou', 'machine'],
    ['no_answer 0,85 (limite)', { amdPrediction: 'no_answer', amdConfidence: 0.85, durationSeconds: 5 }, 'nao_conversou', 'machine'],
    ['number_not_exist 0,95 (gravação de número inexistente)', { amdPrediction: 'number_not_exist', amdConfidence: 0.95, durationSeconds: 8 }, 'nao_conversou', 'machine'],
    ['voicemail 0,84 com 30 s: confiança baixa não decide', { amdPrediction: 'voicemail', amdConfidence: 0.84, durationSeconds: 30 }, 'conversou', 'long_enough'],
    ['voicemail 0,84 com 5 s: cai na regra da duração', { amdPrediction: 'voicemail', amdConfidence: 0.84, durationSeconds: 5 }, 'nao_conversou', 'too_short'],
    ['voicemail 0,84 sem duração: sem dados para decidir', { amdPrediction: 'voicemail', amdConfidence: 0.84 }, 'conversou', 'unknown_fail_open'],
    ['voicemail sem confiança', { amdPrediction: 'voicemail', amdConfidence: null, durationSeconds: 40 }, 'conversou', 'long_enough'],
    ['human 3 s: o alô e a queda são conversa', { amdPrediction: 'human', amdConfidence: 0.9, durationSeconds: 3 }, 'conversou', 'human'],
    ['human com confiança baixa e curta', { amdPrediction: 'human', amdConfidence: 0.3, durationSeconds: 2 }, 'conversou', 'human'],
    ['unknown 20 s', { amdPrediction: 'unknown', amdConfidence: 0.2, durationSeconds: 20 }, 'conversou', 'long_enough'],
    ['9 s sem AMD', { durationSeconds: 9 }, 'nao_conversou', 'too_short'],
    ['10 s sem AMD (limite)', { durationSeconds: 10 }, 'conversou', 'long_enough'],
    ['9,9 s sem AMD', { durationSeconds: 9.9 }, 'nao_conversou', 'too_short'],
    ['0 s sem AMD (atendeu e caiu)', { durationSeconds: 0 }, 'nao_conversou', 'too_short'],
    ['voicemail 0,92 com 60 s: o AMD vence a duração', { amdPrediction: 'voicemail', amdConfidence: 0.92, durationSeconds: 60 }, 'nao_conversou', 'machine'],
    ['human com 60 s', { amdPrediction: 'human', amdConfidence: 0.9, durationSeconds: 60 }, 'conversou', 'human'],
    ['sem dados nenhum', {}, 'conversou', 'unknown_fail_open'],
    ['AMD unknown sem duração', { amdPrediction: 'unknown', amdConfidence: 0.1 }, 'conversou', 'unknown_fail_open'],
    ['duração inválida (NaN) sem AMD', { durationSeconds: Number.NaN }, 'conversou', 'unknown_fail_open'],
  ];
  it.each(cases)('%s', (_name, over, verdict, reason) => {
    expect(getAnsweredVerdict(input(over))).toEqual({ verdict, reason });
  });
});

describe('extractAmd', () => {
  it('metadata válido: prediction e confidence', () => {
    expect(extractAmd({ live_amd: { prediction: 'voicemail', confidence: 0.92, phrase: 'deixe sua mensagem' }, outro: 1 })).toEqual({
      prediction: 'voicemail',
      confidence: 0.92,
    });
    expect(extractAmd({ live_amd: { prediction: 'human', confidence: 0 } })).toEqual({ prediction: 'human', confidence: 0 });
    expect(extractAmd({ live_amd: { prediction: 'number_not_exist', confidence: 1 } })).toEqual({ prediction: 'number_not_exist', confidence: 1 });
  });

  it('metadata vazio, nulo, indefinido ou de tipo errado => null', () => {
    for (const value of [null, undefined, {}, [], 'texto', 42, true, { live_amd: null }, { live_amd: [] }, { live_amd: 'x' }, { live_amd: {} }]) {
      expect(extractAmd(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('prediction desconhecida ou de tipo errado => null', () => {
    expect(extractAmd({ live_amd: { prediction: 'robot', confidence: 0.9 } })).toBeNull();
    expect(extractAmd({ live_amd: { prediction: 5, confidence: 0.9 } })).toBeNull();
  });

  it('confiança fora de 0-1, não numérica ou NaN => confidence null (a previsão é mantida)', () => {
    for (const confidence of [1.2, -0.1, 90, '0.9', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(extractAmd({ live_amd: { prediction: 'voicemail', confidence } }), String(confidence)).toEqual({ prediction: 'voicemail', confidence: null });
    }
  });

  it('o resultado alimenta o veredito (confiança inválida não decide máquina)', () => {
    const amd = extractAmd({ live_amd: { prediction: 'voicemail', confidence: 90 } });
    expect(getAnsweredVerdict({ answeredAt: AT, durationSeconds: 30, amdPrediction: amd?.prediction ?? null, amdConfidence: amd?.confidence ?? null })).toEqual({
      verdict: 'conversou',
      reason: 'long_enough',
    });
  });
});
