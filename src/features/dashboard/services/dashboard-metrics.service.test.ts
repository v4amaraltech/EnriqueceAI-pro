import { describe, expect, it, vi } from 'vitest';

import { fetchAvailableCadences, fetchOpportunityKpi } from './dashboard-metrics.service';
import { expectedByBusinessDay } from '../utils/pacing';

// --- Chainable + thenable mock builder (Supabase queries are PromiseLike) ---
function createChainMock(finalResult: unknown = { data: null }) {
  const chain: Record<string, unknown> = {};

  // Thenable: allows `await supabase.from('x').select(...).eq(...)`
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve);

  // Chainable methods
  for (const method of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }

  // Terminal methods that return a new promise
  chain.maybeSingle = vi.fn(() => {
    return Promise.resolve(finalResult);
  });
  chain.single = vi.fn(() => Promise.resolve(finalResult));

  return chain;
}

function createMockSupabase(fromImpl: (table: string) => Record<string, unknown>) {
  return { from: vi.fn(fromImpl) } as unknown;
}

const ORG_ID = 'org-test-1';

describe('fetchOpportunityKpi', () => {
  const baseFilters = { month: '2026-01', cadenceIds: [] as string[], userIds: [] as string[] };

  it('should return 0 opportunities when no qualified leads exist', async () => {
    const leadsChain = createChainMock({ data: [] });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, baseFilters);

    expect(result.totalOpportunities).toBe(0);
    expect(result.monthTarget).toBe(0);
    expect(result.dailyData).toHaveLength(31); // January has 31 days
  });

  it('conta reuniões realizadas pelo horário do evento', async () => {
    const leads = [
      { id: 'l1', meeting_starts_at: '2026-01-05T10:00:00Z', assigned_to: null },
      { id: 'l2', meeting_starts_at: '2026-01-10T10:00:00Z', assigned_to: null },
      { id: 'l3', meeting_starts_at: '2026-01-10T14:00:00Z', assigned_to: null },
    ];
    const leadsChain = createChainMock({ data: leads });
    const goalsChain = createChainMock({
      data: { opportunity_target: 50, conversion_target: 10 },
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, baseFilters);

    expect(result.totalOpportunities).toBe(3);
    expect(result.monthTarget).toBe(50);
    expect(result.conversionTarget).toBe(10);
  });

  it('should compute cumulative daily data correctly', async () => {
    const leads = [
      { id: 'l1', meeting_starts_at: '2026-02-01T10:00:00Z', assigned_to: null },
      { id: 'l2', meeting_starts_at: '2026-02-01T14:00:00Z', assigned_to: null },
      { id: 'l3', meeting_starts_at: '2026-02-03T10:00:00Z', assigned_to: null },
    ];
    const leadsChain = createChainMock({ data: leads });
    const goalsChain = createChainMock({
      data: { opportunity_target: 28, conversion_target: 5 },
    });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const filters = { ...baseFilters, month: '2026-02' };
    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, filters);

    // Day 1: 2 leads cumulative
    expect(result.dailyData[0]?.actual).toBe(2);
    // Day 2: still 2 (no new leads)
    expect(result.dailyData[1]?.actual).toBe(2);
    // Day 3: 3 (one more)
    expect(result.dailyData[2]?.actual).toBe(3);

    // Target paces on WORKING DAYS (weekdays minus holidays), not calendar days.
    // Feb 2026 has 18 working days (20 weekdays minus Carnaval 16–17). Feb 1 is a
    // Sunday, Feb 2 a Monday, Feb 3 a Tuesday (none are holidays).
    // target[day] = round(28 * businessDaysThrough(day) / 18)
    expect(result.dailyData[0]?.target).toBe(0); // Sun → 0 working days → 0
    expect(result.dailyData[1]?.target).toBe(2); // Mon → 1 working day → round(1.56) = 2
    expect(result.dailyData[2]?.target).toBe(3); // Tue → 2 working days → round(3.11) = 3
  });

  it('should return zero data when no won leads exist under cadence filter', async () => {
    const leadsChain = createChainMock({ data: [] });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      return createChainMock();
    });

    const filters = { ...baseFilters, cadenceIds: ['cad-1'] };
    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, filters);

    expect(result.totalOpportunities).toBe(0);
    expect(result.monthTarget).toBe(0);
  });

  it('should narrow won leads to those enrolled in the filtered cadence', async () => {
    // Two won leads; only l1 is enrolled in the filtered cadence.
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', meeting_starts_at: '2026-01-05T10:00:00Z', assigned_to: null },
        { id: 'l2', meeting_starts_at: '2026-01-06T10:00:00Z', assigned_to: null },
      ],
    });
    const enrollmentChain = createChainMock({ data: [{ lead_id: 'l1' }] });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      if (table === 'cadence_enrollments') return enrollmentChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const filters = { ...baseFilters, cadenceIds: ['cad-1'] };
    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, filters);

    expect(result.totalOpportunities).toBe(1);
    // Enrollment query filters by the won lead_ids and the cadence filter
    expect(enrollmentChain.in).toHaveBeenCalledWith('lead_id', ['l1', 'l2']);
    expect(enrollmentChain.in).toHaveBeenCalledWith('cadence_id', ['cad-1']);
  });

  it('atribui reuniões realizadas ao SDR responsável (assigned_to) sob filtro de vendedor', async () => {
    // l1 é do SDR filtrado; l2 é de outro SDR; l3 não tem responsável.
    // Mesma regra do ranking "Reuniões Realizadas" — não usa won_by.
    const leadsChain = createChainMock({
      data: [
        { id: 'l1', meeting_starts_at: '2026-01-05T10:00:00Z', assigned_to: 'sdr-a' },
        { id: 'l2', meeting_starts_at: '2026-01-06T10:00:00Z', assigned_to: 'sdr-b' },
        { id: 'l3', meeting_starts_at: '2026-01-07T10:00:00Z', assigned_to: null },
      ],
    });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const filters = { ...baseFilters, userIds: ['sdr-a'] };
    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, filters);

    expect(result.totalOpportunities).toBe(1);
    const last = result.dailyData.filter((d) => d.actual !== null).at(-1);
    expect(last?.actual).toBe(1);
  });

  it('should handle February with 28 days', async () => {
    const leadsChain = createChainMock({ data: [] });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const filters = { ...baseFilters, month: '2026-02' };
    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, filters);

    expect(result.daysInMonth).toBe(28);
    expect(result.dailyData).toHaveLength(28);
  });

  it('should compute percentOfTarget as 0 when no target set', async () => {
    const leadsChain = createChainMock({
      data: [{ id: 'l1', meeting_starts_at: '2026-01-05T10:00:00Z', assigned_to: null }],
    });
    const goalsChain = createChainMock({ data: null });

    const supabase = createMockSupabase((table) => {
      if (table === 'leads') return leadsChain;
      if (table === 'goals') return goalsChain;
      return createChainMock();
    });

    const result = await fetchOpportunityKpi(supabase as never, ORG_ID, baseFilters);

    expect(result.percentOfTarget).toBe(0);
  });

  it('conta até HOJE (número grande = último ponto da série); pacing usa o dia fechado (ontem)', async () => {
    // Régua dupla — espelha o Sales Hub: CONTAGEM (total + série) vai até HOJE (13/ago),
    // então o evento de hoje aparece no número grande E no último ponto do gráfico; o
    // PACING ("esperado"/%) usa o dia fechado de ONTEM (12).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T12:00:00Z')); // 09:00 BRT do dia 13
    try {
      const leads = [
        { id: 'a', meeting_starts_at: '2026-08-05T10:00:00Z', assigned_to: null },
        { id: 'b', meeting_starts_at: '2026-08-12T10:00:00Z', assigned_to: null },
        { id: 'c', meeting_starts_at: '2026-08-13T10:00:00Z', assigned_to: null }, // hoje
      ];
      const leadsChain = createChainMock({ data: leads });
      const goalsChain = createChainMock({
        data: { meetings_held_target: 100, conversion_target: 10 },
      });
      const supabase = createMockSupabase((table) => {
        if (table === 'leads') return leadsChain;
        if (table === 'goals') return goalsChain;
        return createChainMock();
      });

      const result = await fetchOpportunityKpi(supabase as never, ORG_ID, {
        month: '2026-08',
        cadenceIds: [],
        userIds: [],
      });

      // A query vai até o fim do MÊS (conta até hoje: reunião já realizada nunca é futura).
      const ltCalls = (leadsChain.lt as ReturnType<typeof vi.fn>).mock.calls;
      const startsAtLt = ltCalls.find((c: unknown[]) => c[0] === 'meeting_starts_at');
      expect(startsAtLt?.[1]).toBe('2026-08-31T23:59:59-03:00');

      // Número grande inclui o evento de hoje.
      expect(result.totalOpportunities).toBe(3);
      // Série acumula até HOJE (dia 13) — último ponto = número grande; futuro é null.
      expect(result.dailyData[11]?.actual).toBe(2); // dia 12
      expect(result.dailyData[12]?.actual).toBe(3); // dia 13 (hoje) = número grande
      expect(result.dailyData[13]?.actual).toBeNull(); // dia 14 (futuro)
      expect(result.dailyData[30]?.actual).toBeNull(); // dia 31 (futuro)
      // Pacing continua no dia fechado de ontem (12) — régua separada da contagem.
      expect(result.currentDay).toBe(12);
      // Meta da SÉRIE no ponto de HOJE (dia 13) = meta do dia FECHADO (ontem, 12),
      // batendo com o "esperado até hoje" do card (não a meta do dia cheio, maior).
      const expectedByYesterday = Math.round(expectedByBusinessDay(100, 2026, 8, 12));
      expect(result.dailyData[12]?.target).toBe(expectedByYesterday); // dia 13 (hoje)
      expect(result.dailyData[11]?.target).toBe(expectedByYesterday); // dia 12 (ontem) — mesmo valor
      // Dia futuro segue a projeção normal do próprio dia (linha ainda sobe até a meta cheia).
      expect(result.dailyData[13]?.target).toBe(Math.round(expectedByBusinessDay(100, 2026, 8, 14)));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetchAvailableCadences', () => {
  it('should return cadences for the org', async () => {
    const cadences = [
      { id: 'c1', name: 'Inbound' },
      { id: 'c2', name: 'Outbound' },
    ];
    const chain = createChainMock({ data: cadences });

    const supabase = createMockSupabase(() => chain);

    const result = await fetchAvailableCadences(supabase as never, ORG_ID);

    expect(result).toEqual(cadences);
    expect(result).toHaveLength(2);
  });

  it('should return empty array when no cadences exist', async () => {
    const chain = createChainMock({ data: null });

    const supabase = createMockSupabase(() => chain);

    const result = await fetchAvailableCadences(supabase as never, ORG_ID);

    expect(result).toEqual([]);
  });

  it('should filter by active and paused status', async () => {
    const chain = createChainMock({ data: [] });

    const supabase = createMockSupabase(() => chain);

    await fetchAvailableCadences(supabase as never, ORG_ID);

    expect(chain.in).toHaveBeenCalledWith('status', ['active', 'paused']);
  });
});
