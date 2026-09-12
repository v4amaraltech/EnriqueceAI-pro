import { describe, expect, it } from 'vitest';

import { latestSaoByLead } from './latest-sao-by-lead';

describe('latestSaoByLead', () => {
  it('usa a resposta mais recente por lead', () => {
    const map = latestSaoByLead([
      { lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-09-09T10:00:00Z' },
      { lead_id: 'l1', oportunidade_qualificada: false, responded_at: '2026-09-11T10:00:00Z' },
      { lead_id: 'l2', oportunidade_qualificada: false, responded_at: '2026-09-09T10:00:00Z' },
      { lead_id: 'l2', oportunidade_qualificada: true, responded_at: '2026-09-11T10:00:00Z' },
    ]);
    expect(map.get('l1')).toBe(false);
    expect(map.get('l2')).toBe(true);
  });

  it('não depende da ordem das linhas', () => {
    const map = latestSaoByLead([
      { lead_id: 'l1', oportunidade_qualificada: false, responded_at: '2026-09-11T10:00:00Z' },
      { lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-09-09T10:00:00Z' },
    ]);
    expect(map.get('l1')).toBe(false);
  });

  it('ignora requests sem resposta (pendente/expirado) e sem a pergunta de SAO', () => {
    const map = latestSaoByLead([
      // true antiga + request novo pendente (reatribuição de closer): vale o true
      { lead_id: 'l1', oportunidade_qualificada: true, responded_at: '2026-09-09T10:00:00Z' },
      { lead_id: 'l1', oportunidade_qualificada: null, responded_at: null },
      // resposta sem a pergunta (no-show / histórico antigo) não anula nem conta
      { lead_id: 'l2', oportunidade_qualificada: true, responded_at: '2026-09-09T10:00:00Z' },
      { lead_id: 'l2', oportunidade_qualificada: null, responded_at: '2026-09-12T10:00:00Z' },
      // só pendente: ausente do mapa
      { lead_id: 'l3', oportunidade_qualificada: null, responded_at: null },
    ]);
    expect(map.get('l1')).toBe(true);
    expect(map.get('l2')).toBe(true);
    expect(map.has('l3')).toBe(false);
  });

  it('lead sem linha não aparece no mapa (ausente ≠ não qualificada)', () => {
    const map = latestSaoByLead([
      { lead_id: 'l1', oportunidade_qualificada: false, responded_at: '2026-09-09T10:00:00Z' },
    ]);
    expect(map.get('l1')).toBe(false);
    expect(map.has('l9')).toBe(false);
    expect(map.size).toBe(1);
  });

  it('retorna mapa vazio sem linhas', () => {
    expect(latestSaoByLead([]).size).toBe(0);
  });
});
