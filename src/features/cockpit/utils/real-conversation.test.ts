import { describe, expect, it } from 'vitest';

import { hadRealConversation, isRealConversation, type RealConversationCall } from './real-conversation';

const answered = (duration: number, over: RealConversationCall = {}): RealConversationCall => ({
  answered_at: '2026-11-13T15:00:05Z',
  duration_seconds: duration,
  status: 'not_significant',
  ...over,
});
const ai = (over: Record<string, unknown> = {}) => ({
  ai_outcome: { status: 'done', disposition: 'relevant_conversation', confidence: 0.9, applied: true, needs_review: false, ...over },
});

describe('isRealConversation: telemetria (sem desfecho)', () => {
  it.each([
    [0, false],
    [8, false],
    [49, false],
    [50, true],
    [51, true],
    [300, true],
  ])('atendida com %i s → %s (fronteira 49/50 s)', (duration, expected) => {
    expect(isRealConversation(answered(duration))).toBe(expected);
  });

  it('sem answered_at nunca é conversa, nem com 120 s', () => {
    expect(isRealConversation({ answered_at: null, duration_seconds: 120 })).toBe(false);
  });

  it('duração ausente conta como 0', () => {
    expect(isRealConversation({ answered_at: 'x', duration_seconds: null })).toBe(false);
  });
});

describe('isRealConversation: desfecho do SDR vale primeiro', () => {
  it.each(['relevant_conversation', 'answered_no_progress', 'callback_requested'])('%s = conversa, mesmo curta e sem answered_at', (d) => {
    expect(isRealConversation({ sdr_disposition: d, answered_at: null, duration_seconds: 3 })).toBe(true);
  });

  it.each(['voicemail', 'no_answer', 'technical_failure'])('%s = NÃO é conversa, mesmo com 120 s atendida', (d) => {
    expect(isRealConversation(answered(120, { sdr_disposition: d }))).toBe(false);
  });

  it('SDR sobrepõe a IA nos dois sentidos', () => {
    expect(isRealConversation(answered(120, { sdr_disposition: 'voicemail', metadata: ai({ disposition: 'relevant_conversation' }) }))).toBe(false);
    expect(isRealConversation(answered(5, { sdr_disposition: 'relevant_conversation', metadata: ai({ disposition: 'voicemail' }) }))).toBe(true);
  });

  it('desfecho desconhecido cai para a próxima fonte', () => {
    expect(isRealConversation(answered(60, { sdr_disposition: 'qualquer' }))).toBe(true);
    expect(isRealConversation(answered(10, { sdr_disposition: 'qualquer' }))).toBe(false);
  });
});

describe('isRealConversation: desfecho da IA aplicado (sem desfecho do SDR)', () => {
  it('IA conversa, aplicada e confiante → conversa, mesmo curta', () => {
    expect(isRealConversation(answered(10, { metadata: ai() }))).toBe(true);
  });
  it('IA caixa postal → não é conversa, mesmo com 120 s', () => {
    expect(isRealConversation(answered(120, { metadata: ai({ disposition: 'voicemail' }) }))).toBe(false);
  });
  it('IA sem confiança mínima (0,69), em revisão, não aplicada, pendente ou com falha NÃO decide: cai na duração', () => {
    for (const over of [{ confidence: 0.69 }, { confidence: null }, { needs_review: true }, { applied: false }, { status: 'pending' }, { status: 'failed' }, { disposition: null }]) {
      expect(isRealConversation(answered(10, { metadata: ai(over) })), JSON.stringify(over)).toBe(false);
      expect(isRealConversation(answered(60, { metadata: ai(over) })), JSON.stringify(over)).toBe(true);
    }
  });
  it('confiança exatamente 0,7 vale', () => {
    expect(isRealConversation(answered(10, { metadata: ai({ confidence: 0.7 }) }))).toBe(true);
  });
  it('metadata lixo não quebra', () => {
    expect(isRealConversation(answered(60, { metadata: 'x' }))).toBe(true);
    expect(isRealConversation(answered(60, { metadata: null }))).toBe(true);
  });
});

describe('hadRealConversation', () => {
  it('basta uma ligação de conversa real entre as do dia', () => {
    expect(hadRealConversation([answered(8, { sdr_disposition: 'voicemail' }), answered(12), answered(80)])).toBe(true);
    expect(hadRealConversation([answered(8, { sdr_disposition: 'voicemail' }), answered(49), { answered_at: null }])).toBe(false);
    expect(hadRealConversation([])).toBe(false);
  });
});
