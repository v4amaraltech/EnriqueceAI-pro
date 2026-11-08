import { describe, expect, it } from 'vitest';

import {
  CALL_PRIORITY_MODEL_VERSION,
  EFFORT_MAX,
  REPLY_FLOOR,
  computeCallPriority,
  rankLeadsByPriority,
  type PrioritySignal,
} from './call-priority';

const NOW = new Date('2026-11-07T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const reply = (key: string, d = 1): PrioritySignal => ({ kind: 'reply', key, at: daysAgo(d), channel: 'email' });
const send = (key: string, type = 'sent', d = 0): PrioritySignal => ({ kind: 'send', key, at: daysAgo(d), channel: 'phone', type });
const sdrCall = (callId: string, disposition: string, key = `call:${callId}:sdr`, d = 1): PrioritySignal => ({
  kind: 'call_outcome',
  key,
  callId,
  at: daysAgo(d),
  by: 'sdr',
  disposition,
});
const aiCall = (callId: string, disposition: string, confidence: number | null, extra: { needsReview?: boolean } = {}): PrioritySignal => ({
  kind: 'call_outcome',
  key: `call:${callId}:ai`,
  callId,
  at: daysAgo(1),
  by: 'ai',
  disposition,
  confidence,
  ...extra,
});
const correction = (key: string, interest: number, d = 0): PrioritySignal => ({
  kind: 'human_correction',
  key,
  at: daysAgo(d),
  actorUserId: 'u1',
  interest,
});

describe('computeCallPriority: versão e estrutura', () => {
  it('sem sinais: score 0, sem fonte e ausências explícitas', () => {
    const r = computeCallPriority([], NOW);
    expect(r.version).toBe(CALL_PRIORITY_MODEL_VERSION);
    expect(r.score).toBe(0);
    expect(r.primarySource).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining(['reply', 'call_outcome', 'transcript', 'bant']));
  });

  it('é determinístico e não depende da ordem dos sinais', () => {
    const a = [reply('r1'), sdrCall('c1', 'relevant_conversation'), send('s1', 'opened'), { kind: 'bant', key: 'bant:l', at: daysAgo(2), filledFields: 2 } as PrioritySignal];
    const b = [...a].reverse();
    expect(computeCallPriority(a, NOW)).toEqual(computeCallPriority(b, NOW));
  });
});

describe('idempotência: replay não soma duas vezes', () => {
  it('mesma chave repetida conta uma vez e a repetição é registrada como ignorada', () => {
    const once = computeCallPriority([reply('r1')], NOW);
    const replayed = computeCallPriority([reply('r1'), reply('r1'), reply('r1')], NOW);
    expect(replayed.score).toBe(once.score);
    expect(replayed.ignored.filter((i) => i.reason === 'duplicate')).toHaveLength(2);
  });

  it('envio repetido (replay de webhook) não aumenta o esforço', () => {
    const once = computeCallPriority([send('s1', 'clicked')], NOW);
    const replayed = computeCallPriority(Array.from({ length: 5 }, () => send('s1', 'clicked')), NOW);
    expect(replayed.effort).toBe(once.effort);
  });

  it('mesmo resultado de ligação reenviado com outra chave conta uma vez por ligação', () => {
    const once = computeCallPriority([sdrCall('c1', 'relevant_conversation')], NOW);
    const twice = computeCallPriority([sdrCall('c1', 'relevant_conversation'), sdrCall('c1', 'relevant_conversation', 'call:c1:sdr:replay')], NOW);
    expect(twice.interest).toBe(once.interest);
  });

  it('BANT repetido não soma: vale o preenchimento mais completo', () => {
    const one = computeCallPriority([{ kind: 'bant', key: 'b1', at: daysAgo(1), filledFields: 2 }], NOW);
    const both = computeCallPriority(
      [
        { kind: 'bant', key: 'b1', at: daysAgo(1), filledFields: 2 },
        { kind: 'bant', key: 'b2', at: daysAgo(1), filledFields: 2 },
      ],
      NOW,
    );
    expect(both.interest).toBe(one.interest);
  });
});

describe('envio nunca vence resposta explícita', () => {
  it('esforço máximo continua abaixo de qualquer resposta', () => {
    const heavySends = Array.from({ length: 60 }, (_, i) => send(`s${i}`, i % 2 ? 'clicked' : 'opened'));
    const noReply = computeCallPriority(heavySends, NOW);
    const oldReply = computeCallPriority([reply('r1', 80)], NOW);
    expect(noReply.effort).toBeLessThanOrEqual(EFFORT_MAX);
    expect(oldReply.interest).toBeGreaterThanOrEqual(REPLY_FLOOR);
    expect(oldReply.score).toBeGreaterThan(noReply.score);
  });

  it('a resposta continua à frente mesmo com esforço somado ao outro lado', () => {
    const ranking = rankLeadsByPriority(
      [
        { leadId: 'so-envio', updatedAt: '2026-11-07T00:00:00Z', signals: Array.from({ length: 40 }, (_, i) => send(`s${i}`, 'clicked')) },
        { leadId: 'respondeu', updatedAt: '2026-01-01T00:00:00Z', signals: [reply('r1', 85)] },
      ],
      NOW,
    );
    expect(ranking.map((r) => r.leadId)).toEqual(['respondeu', 'so-envio']);
  });

  it('lead que respondeu e recebeu envios soma esforço, mas o interesse segue sendo a fonte principal', () => {
    const r = computeCallPriority([reply('r1'), send('s1', 'opened')], NOW);
    expect(r.primarySource).toBe('explicit_reply');
    expect(r.effort).toBeGreaterThan(0);
  });

  it('só envio: a fonte é esforço de envio', () => {
    expect(computeCallPriority([send('s1', 'clicked')], NOW).primarySource).toBe('send_effort');
  });
});

describe('transcrição errada ou ausente', () => {
  it('ausente: não penaliza e aparece em missing', () => {
    const base = computeCallPriority([reply('r1')], NOW);
    expect(base.missing).toContain('transcript');
    expect(computeCallPriority([reply('r1'), sdrCall('c1', 'voicemail')], NOW).interest).toBe(base.interest);
  });

  it('baixa confiança é ignorada, sem somar nem subtrair', () => {
    const r = computeCallPriority([aiCall('c1', 'relevant_conversation', 0.4)], NOW);
    expect(r.interest).toBe(0);
    expect(r.ignored).toContainEqual({ key: 'call:c1:ai', reason: 'low_confidence' });
    expect(r.missing).toContain('transcript');
  });

  it('confiança ausente conta como baixa', () => {
    expect(computeCallPriority([aiCall('c1', 'relevant_conversation', null)], NOW).interest).toBe(0);
  });

  it('marcada para revisão é ignorada mesmo com confiança alta', () => {
    const r = computeCallPriority([aiCall('c1', 'relevant_conversation', 0.95, { needsReview: true })], NOW);
    expect(r.interest).toBe(0);
    expect(r.ignored).toContainEqual({ key: 'call:c1:ai', reason: 'needs_review' });
  });

  it('classificação desconhecida é ignorada', () => {
    const r = computeCallPriority([aiCall('c1', 'qualquer_coisa', 0.99)], NOW);
    expect(r.interest).toBe(0);
    expect(r.ignored).toContainEqual({ key: 'call:c1:ai', reason: 'unknown_disposition' });
  });

  it('com confiança suficiente contribui, com a fonte da transcrição', () => {
    const r = computeCallPriority([aiCall('c1', 'relevant_conversation', 0.9)], NOW);
    expect(r.interest).toBeGreaterThan(0);
    expect(r.primarySource).toBe('transcript_classification');
    expect(r.missing).not.toContain('transcript');
  });

  it('o resultado do SDR prevalece sobre a IA divergente na mesma ligação', () => {
    const r = computeCallPriority([aiCall('c1', 'relevant_conversation', 0.99), sdrCall('c1', 'voicemail')], NOW);
    expect(r.interest).toBe(0);
    expect(r.ignored).toContainEqual({ key: 'call:c1:ai', reason: 'superseded_by_sdr' });
  });
});

describe('correção humana', () => {
  it('prevalece sobre o interesse calculado e fica registrada como fonte', () => {
    const r = computeCallPriority([reply('r1'), sdrCall('c1', 'relevant_conversation'), correction('k1', 0)], NOW);
    expect(r.interest).toBe(0);
    expect(r.humanCorrected).toBe(true);
    expect(r.reasons[0]?.source).toBe('human');
    expect(r.ignored).toContainEqual({ key: 'r1', reason: 'overridden_by_human_correction' });
  });

  it('pode subir o interesse acima do calculado', () => {
    const r = computeCallPriority([send('s1', 'opened'), correction('k1', 80)], NOW);
    expect(r.interest).toBe(80);
    expect(r.primarySource).toBe('human');
  });

  it('a correção mais recente vence; a antiga fica como ignorada', () => {
    const r = computeCallPriority([correction('antiga', 10, 3), correction('nova', 70, 1)], NOW);
    expect(r.interest).toBe(70);
    expect(r.ignored).toContainEqual({ key: 'antiga', reason: 'older_correction' });
  });

  it('o resultado não depende da ordem em que as correções chegam', () => {
    const a = computeCallPriority([correction('antiga', 10, 3), correction('nova', 70, 1)], NOW);
    const b = computeCallPriority([correction('nova', 70, 1), correction('antiga', 10, 3)], NOW);
    expect(a.interest).toBe(b.interest);
  });

  it('a correção repetida (mesma chave) não muda nada', () => {
    const once = computeCallPriority([correction('k1', 55)], NOW);
    expect(computeCallPriority([correction('k1', 55), correction('k1', 55)], NOW).score).toBe(once.score);
  });

  it('valor fora da faixa é limitado a 0..100', () => {
    expect(computeCallPriority([correction('k1', 500)], NOW).interest).toBe(100);
    expect(computeCallPriority([correction('k2', -5)], NOW).interest).toBe(0);
  });

  it('o esforço de envio continua valendo depois da correção, abaixo de qualquer interesse', () => {
    const r = computeCallPriority([correction('k1', 0), send('s1', 'clicked')], NOW);
    expect(r.interest).toBe(0);
    expect(r.effort).toBeGreaterThan(0);
    expect(r.score).toBe(r.effort);
  });
});

describe('ordenação', () => {
  it('desempata por atualização mais recente e depois por id', () => {
    const r = rankLeadsByPriority(
      [
        { leadId: 'b', updatedAt: '2026-11-01T00:00:00Z', signals: [] },
        { leadId: 'c', updatedAt: '2026-11-05T00:00:00Z', signals: [] },
        { leadId: 'a', updatedAt: '2026-11-05T00:00:00Z', signals: [] },
      ],
      NOW,
    );
    expect(r.map((x) => x.leadId)).toEqual(['a', 'c', 'b']);
  });
});
