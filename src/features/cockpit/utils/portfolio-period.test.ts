import { describe, expect, it } from 'vitest';

import {
  applyPortfolio,
  parsePortfolioFilters,
  portfolioRange,
  stageEnteredAt,
  type PortfolioItem,
  type StageDates,
} from './portfolio-period';

// 16/set/2026 23:30 BRT = 17/set 02:30 UTC. Em UTC já é o dia seguinte.
const lateNightBrt = new Date('2026-09-17T02:30:00.000Z');

const dates = (over: Partial<StageDates> = {}): StageDates => ({
  created_at: '2026-08-01T15:00:00.000Z',
  updated_at: '2026-09-16T18:00:00.000Z',
  lost_at: null,
  contacted_at: null,
  qualified_at: null,
  meeting_scheduled_at: null,
  meeting_no_show_at: null,
  meeting_held_at: null,
  won_at: null,
  ...over,
});

function item(
  over: Partial<Omit<PortfolioItem, 'dates'>> & Pick<PortfolioItem, 'id' | 'stage'> & { dates?: Partial<StageDates> },
): PortfolioItem {
  const { dates: dateOver, ...rest } = over;
  return {
    updatedAt: '2026-09-16T18:00:00.000Z',
    haystack: 'acme industria',
    phoneDigits: '11988887777',
    cnpj: '12345678000199',
    ...rest,
    dates: dates(dateOver),
  };
}

describe('período da carteira em America/Sao_Paulo', () => {
  it('lê período e etapa da URL e ignora valor inválido', () => {
    expect(parsePortfolioFilters({ period: '30d', stage: 'entrada', from: '2026-09-01', to: 'nope' })).toEqual({
      period: '30d',
      stage: 'entrada',
      from: '2026-09-01',
      to: null,
    });
    expect(parsePortfolioFilters({ period: 'ano', stage: 'xyz' })).toEqual({
      period: null,
      stage: null,
      from: null,
      to: null,
    });
  });

  it('Tudo não corta data', () => {
    expect(portfolioRange({ period: null, from: null, to: null, stage: null }, lateNightBrt)).toBeNull();
  });

  it('Hoje é o dia BRT, mesmo depois das 21h quando o UTC já virou', () => {
    expect(portfolioRange({ period: 'today', from: null, to: null, stage: null }, lateNightBrt)).toEqual({
      gte: '2026-09-16T03:00:00.000Z',
      lte: '2026-09-17T02:59:59.999Z',
    });
  });

  it('7 dias e 30 dias incluem hoje e os dias anteriores no calendário BRT', () => {
    expect(portfolioRange({ period: '7d', from: null, to: null, stage: null }, lateNightBrt)).toEqual({
      gte: '2026-09-10T03:00:00.000Z',
      lte: '2026-09-17T02:59:59.999Z',
    });
    expect(portfolioRange({ period: '30d', from: null, to: null, stage: null }, lateNightBrt)).toEqual({
      gte: '2026-08-18T03:00:00.000Z',
      lte: '2026-09-17T02:59:59.999Z',
    });
  });

  it('Este mês vai do dia 1 até o fim de hoje', () => {
    expect(portfolioRange({ period: 'month', from: null, to: null, stage: null }, lateNightBrt)).toEqual({
      gte: '2026-09-01T03:00:00.000Z',
      lte: '2026-09-17T02:59:59.999Z',
    });
  });

  it('Personalizado inclui os dois dias e aceita o intervalo invertido', () => {
    expect(portfolioRange({
      period: 'custom',
      from: '2026-09-05',
      to: '2026-09-01',
      stage: null,
    }, lateNightBrt)).toEqual({
      gte: '2026-09-01T03:00:00.000Z',
      lte: '2026-09-06T02:59:59.999Z',
    });
  });
});

describe('data de entrada na etapa', () => {
  it('usa a coluna da etapa e cai em updated_at quando ela falta', () => {
    const base = dates({
      lost_at: '2026-09-02T12:00:00.000Z',
      contacted_at: '2026-09-03T12:00:00.000Z',
      qualified_at: '2026-09-04T12:00:00.000Z',
      meeting_scheduled_at: '2026-09-05T12:00:00.000Z',
      meeting_no_show_at: '2026-09-06T12:00:00.000Z',
      meeting_held_at: '2026-09-07T12:00:00.000Z',
    });
    expect(stageEnteredAt('entrada', base)).toBe(base.created_at);
    expect(stageEnteredAt('desqualificado', base)).toBe(base.lost_at);
    expect(stageEnteredAt('tentativa', base)).toBe(base.contacted_at);
    expect(stageEnteredAt('conexao', base)).toBe(base.qualified_at);
    expect(stageEnteredAt('sql', base)).toBe(base.meeting_scheduled_at);
    expect(stageEnteredAt('no_show', base)).toBe(base.meeting_no_show_at);
    expect(stageEnteredAt('sal', base)).toBe(base.meeting_held_at);
    expect(stageEnteredAt('sal', dates({ won_at: '2026-09-08T12:00:00.000Z' }))).toBe('2026-09-08T12:00:00.000Z');
    expect(stageEnteredAt('conexao', dates())).toBe(dates().updated_at);
    expect(stageEnteredAt('desqualificado', dates())).toBe(dates().updated_at);
    expect(stageEnteredAt('entrada', dates())).toBe(dates().created_at);
  });
});

describe('cartão e lista usam o mesmo corte', () => {
  const today = portfolioRange({ period: 'today', from: null, to: null, stage: null }, lateNightBrt);

  const leads: PortfolioItem[] = [
    item({ id: 'entrada-hoje', stage: 'entrada', dates: dates({ created_at: '2026-09-16T15:00:00.000Z' }) }),
    item({ id: 'entrada-antiga', stage: 'entrada', dates: dates({ created_at: '2026-08-01T15:00:00.000Z', updated_at: '2026-09-16T18:00:00.000Z' }) }),
    item({ id: 'sql-hoje', stage: 'sql', dates: dates({ meeting_scheduled_at: '2026-09-16T18:00:00.000Z' }), haystack: 'roberta viviane' }),
    item({ id: 'sql-ontem', stage: 'sql', dates: dates({ meeting_scheduled_at: '2026-09-15T18:00:00.000Z' }) }),
    item({ id: 'conexao-fallback', stage: 'conexao', dates: dates({ qualified_at: null, updated_at: '2026-09-16T20:00:00.000Z' }) }),
    item({ id: 'conexao-qualified-antigo', stage: 'conexao', dates: dates({ qualified_at: '2026-09-01T15:00:00.000Z', updated_at: '2026-09-16T20:00:00.000Z' }) }),
    item({ id: 'sal-won', stage: 'sal', dates: dates({ meeting_held_at: null, won_at: '2026-09-16T12:00:00.000Z' }) }),
  ];

  it('a contagem de cada cartão é o tamanho da lista daquela etapa, sem busca', () => {
    const { counts, matches } = applyPortfolio(leads, { range: today, stage: null, search: '' });
    expect(counts.entrada).toBe(1);
    expect(counts.sql).toBe(1);
    expect(counts.conexao).toBe(1);
    expect(counts.sal).toBe(1);
    expect(counts.tentativa).toBe(0);
    expect(matches).toHaveLength(4);

    for (const stage of ['entrada', 'sql', 'conexao', 'sal'] as const) {
      const filtered = applyPortfolio(leads, { range: today, stage, search: '' });
      expect(filtered.counts[stage]).toBe(counts[stage]);
      expect(filtered.matches).toHaveLength(counts[stage]);
      expect(filtered.matches.every((lead) => lead.stage === stage)).toBe(true);
    }
  });

  it('a busca reduz a lista e não mexe na contagem do cartão', () => {
    const open = applyPortfolio(leads, { range: today, stage: 'sql', search: '' });
    const searched = applyPortfolio(leads, { range: today, stage: 'sql', search: 'roberta' });
    expect(searched.counts.sql).toBe(open.counts.sql);
    expect(searched.matches.map((lead) => lead.id)).toEqual(['sql-hoje']);
  });
});
