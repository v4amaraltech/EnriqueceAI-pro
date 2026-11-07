import { describe, expect, it } from 'vitest';

import { pickNextLead } from './next-lead';

const now = new Date('2026-11-07T12:00:00Z');
const c = (id: string, updatedAt: string, noShowAt: string | null = null) => ({ id, updatedAt, noShowAt });

describe('pickNextLead', () => {
  it('sem candidatos devolve null', () => {
    expect(pickNextLead({ candidates: [], interactions: [], now })).toBeNull();
  });

  it('resposta recente vence no-show e interação', () => {
    const id = pickNextLead({
      candidates: [c('a', '2026-11-07T10:00:00Z', '2026-11-05T00:00:00Z'), c('b', '2026-11-01T00:00:00Z'), c('c', '2026-11-06T00:00:00Z')],
      interactions: [
        { leadId: 'b', type: 'replied', at: '2026-11-06T00:00:00Z' },
        { leadId: 'c', type: 'opened', at: '2026-11-06T00:00:00Z' },
      ],
      now,
    });
    expect(id).toBe('b');
  });

  it('resposta antiga não conta; no-show recente vence abertura', () => {
    const id = pickNextLead({
      candidates: [c('a', '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z'), c('b', '2026-11-06T00:00:00Z')],
      interactions: [
        { leadId: 'b', type: 'replied', at: '2026-10-01T00:00:00Z' },
        { leadId: 'b', type: 'opened', at: '2026-11-06T00:00:00Z' },
      ],
      now,
    });
    expect(id).toBe('a');
  });

  it('empate vai para o atualizado mais recentemente', () => {
    expect(pickNextLead({ candidates: [c('a', '2026-11-01T00:00:00Z'), c('b', '2026-11-03T00:00:00Z')], interactions: [], now })).toBe('b');
  });
});
