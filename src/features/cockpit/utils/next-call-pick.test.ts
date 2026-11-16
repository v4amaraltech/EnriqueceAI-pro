import { describe, expect, it } from 'vitest';

import { computeCallPriority, rankLeadsByPriority, type RankedLead } from '@/features/contact-engine/services/call-priority';

import { pickCockpitLead } from './next-call-pick';

const NOW = new Date('2026-11-15T12:00:00Z');

const hotLead = (leadId: string): RankedLead => ({
  leadId,
  result: computeCallPriority([{ kind: 'reply', key: `r:${leadId}`, at: '2026-11-14T10:00:00Z', channel: 'email' }], NOW),
});
const zeroInterest = (leadId: string): RankedLead => ({ leadId, result: computeCallPriority([], NOW) });

describe('pickCockpitLead', () => {
  it('quente confirmado vence 100 frios', () => {
    const cold = Array.from({ length: 100 }, (_, i) => ({ leadId: `c${i}`, coldRank: i + 1 }));
    expect(pickCockpitLead({ hot: [hotLead('h1')], cold })).toEqual({ leadId: 'h1', tier: 'hot' });
  });

  it('sem quente: menor coldRank, marcado como frio', () => {
    const cold = [
      { leadId: 'b', coldRank: 2 },
      { leadId: 'a', coldRank: 1 },
    ];
    expect(pickCockpitLead({ hot: [], cold })).toEqual({ leadId: 'a', tier: 'cold' });
  });

  it('possível quente com interesse 0 não conta como quente e volta à posição de frio', () => {
    const cold = [
      { leadId: 'x', coldRank: 1 },
      { leadId: 'maybe', coldRank: 2 },
    ];
    expect(pickCockpitLead({ hot: [zeroInterest('maybe')], cold })).toEqual({ leadId: 'x', tier: 'cold' });
    expect(pickCockpitLead({ hot: [zeroInterest('maybe')], cold: [{ leadId: 'maybe', coldRank: 1 }] })).toEqual({ leadId: 'maybe', tier: 'cold' });
  });

  it('só esforço de envio (interesse 0) não esquenta o lead', () => {
    const sent = rankLeadsByPriority(
      [{ leadId: 's', updatedAt: '2026-11-14T00:00:00Z', signals: [{ kind: 'send', key: 's1', at: '2026-11-14T08:00:00Z', channel: 'email', type: 'sent' }] }],
      NOW,
    );
    expect(pickCockpitLead({ hot: sent, cold: [{ leadId: 'f', coldRank: 1 }] })).toEqual({ leadId: 'f', tier: 'cold' });
  });

  it('listas vazias devolvem null', () => {
    expect(pickCockpitLead({ hot: [], cold: [] })).toBeNull();
  });

  it('empate de coldRank é estável (leadId) e a mesma entrada dá a mesma saída', () => {
    const cold = [
      { leadId: 'z', coldRank: 1 },
      { leadId: 'a', coldRank: 1 },
    ];
    const first = pickCockpitLead({ hot: [], cold });
    expect(first).toEqual({ leadId: 'a', tier: 'cold' });
    expect(pickCockpitLead({ hot: [], cold: [...cold].reverse() })).toEqual(first);
  });
});
