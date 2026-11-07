import { describe, expect, it } from 'vitest';

import { leadStageLabel, leadTemperature, leadTier, tierFromFaturamento } from './lead-insights';

const now = new Date('2026-11-06T15:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('leadTemperature', () => {
  it('quente quando respondeu nos últimos 7 dias', () => {
    expect(leadTemperature({ now, lastReplyAt: daysAgo(3), lastInteractionAt: daysAgo(3), meetingScheduledAt: null })).toBe('quente');
  });

  it('quente quando marcou reunião nos últimos 7 dias', () => {
    expect(leadTemperature({ now, lastReplyAt: null, lastInteractionAt: null, meetingScheduledAt: daysAgo(6) })).toBe('quente');
  });

  it('morno com interação em até 21 dias e resposta antiga', () => {
    expect(leadTemperature({ now, lastReplyAt: daysAgo(30), lastInteractionAt: daysAgo(20), meetingScheduledAt: null })).toBe('morno');
  });

  it('frio sem nada recente', () => {
    expect(leadTemperature({ now, lastReplyAt: null, lastInteractionAt: daysAgo(40), meetingScheduledAt: daysAgo(60) })).toBe('frio');
  });
});

describe('tier', () => {
  it('segue as faixas da função SQL', () => {
    expect(tierFromFaturamento(50_000)).toBe('Não ICP');
    expect(tierFromFaturamento(100_000)).toBe('Tiny');
    expect(tierFromFaturamento(150_000)).toBe('Small');
    expect(tierFromFaturamento(4_000_000)).toBe('Medium');
    expect(tierFromFaturamento(40_000_000)).toBe('Large');
    expect(tierFromFaturamento(40_000_001)).toBe('Enterprise');
    expect(tierFromFaturamento(null)).toBeNull();
  });

  it('prefere o tier gravado no lead', () => {
    expect(leadTier('Large', 10)).toBe('Large');
    expect(leadTier('  ', 150_000)).toBe('Small');
    expect(leadTier(null, null)).toBeNull();
  });
});

describe('leadStageLabel', () => {
  it('traduz a etapa', () => {
    expect(leadStageLabel('sql')).toBe('Reunião agendada (SQL)');
    expect(leadStageLabel('xyz')).toBe('—');
  });
});
