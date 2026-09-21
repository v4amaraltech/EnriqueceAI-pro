import { describe, expect, it } from 'vitest';

import { admissibleCount, companyKey, diasUteis, effectiveDailyCap, projectCommitments } from './capacity';

const now = new Date('2026-09-21T12:00:00-03:00');

describe('effectiveDailyCap', () => {
  it('rampa 10 → 40 → 80 pela idade da conexão; explícito e pausa vencem', () => {
    expect(effectiveDailyCap({ dailyCap: null, connectedAt: '2026-09-20', pausedReason: null, now })).toBe(10);
    expect(effectiveDailyCap({ dailyCap: null, connectedAt: '2026-09-10', pausedReason: null, now })).toBe(40);
    expect(effectiveDailyCap({ dailyCap: null, connectedAt: '2026-08-01', pausedReason: null, now })).toBe(80);
    expect(effectiveDailyCap({ dailyCap: 25, connectedAt: '2026-08-01', pausedReason: null, now })).toBe(25);
    expect(effectiveDailyCap({ dailyCap: 80, connectedAt: '2026-08-01', pausedReason: 'bounce alto', now })).toBe(0);
  });
});

describe('admissão olha os próximos dias, não só hoje', () => {
  const dias = diasUteis(14, now);
  const steps = new Map([['cad', [
    { step_order: 1, delay_days: 0, channel: 'email' }, { step_order: 2, delay_days: 3, channel: 'email' },
    { step_order: 3, delay_days: 4, channel: 'email' }, { step_order: 4, delay_days: 6, channel: 'email' },
  ]]]);
  it('projeta compromissos das inscrições ativas por dia útil', () => {
    const committed = projectCommitments({ enrollments: [{ cadence_id: 'cad', current_step: 1, next_step_due: now.toISOString() }], stepsByCadence: steps, dias });
    expect(committed.get(dias[0]!)).toBe(1);
    expect(committed.get(dias[3]!)).toBe(1);
    expect(committed.get(dias[7]!)).toBe(1);
    expect(committed.get(dias[13]!)).toBe(1);
  });
  it('admissíveis = mínimo de livre nos offsets, com 30% reservado para conversas', () => {
    const committed = new Map(dias.map((d) => [d, 0]));
    committed.set(dias[7]!, 50); // dia 7 já cheio de follow-ups
    const r = admissibleCount({ dias, capPerDay: 80, committed, offsets: [0, 3, 7, 13] });
    expect(r.porDia[0]!.teto).toBe(56);
    expect(r.admissiveis).toBe(6); // 56 − 50 no dia 7
    expect(r.gargalo).toBe(dias[7]);
  });
  it('caixa pausada → zero admissíveis', () => {
    const r = admissibleCount({ dias, capPerDay: 0, committed: new Map(), offsets: [0, 3] });
    expect(r.admissiveis).toBe(0);
  });
});

describe('companyKey', () => {
  it('CNPJ raiz vence; nome normalizado sem sufixos', () => {
    expect(companyKey({ cnpj: '12.345.678/0001-90' })).toBe('cnpj:12345678');
    expect(companyKey({ cnpj: '12.345.678/0002-71' })).toBe('cnpj:12345678');
    expect(companyKey({ razaoSocial: 'Arroz Ruzene Indústria e Comércio LTDA' })).toBe('nome:arrozruzene');
    expect(companyKey({ nomeFantasia: 'Arroz Ruzene' })).toBe('nome:arrozruzene');
    expect(companyKey({})).toBeNull();
  });
});
