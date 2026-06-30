import { describe, expect, it, vi } from 'vitest';

vi.mock('./member-lookup', () => ({
  buildMemberInfoMap: vi.fn(() =>
    Promise.resolve(new Map([['u1', { name: 'Ana' }], ['u2', { name: 'Bruno' }]])),
  ),
}));

import { fetchLossReasonAnalyticsData } from './loss-reason-analytics.service';

const CHAIN = ['select', 'eq', 'is', 'in', 'gte', 'lte', 'not', 'limit', 'order'];

function makeBuilder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of CHAIN) b[m] = vi.fn(() => b);
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result, error: null }).then(resolve);
  return b;
}

function makeSupabase(resultsByTable: Record<string, unknown>) {
  return { from: vi.fn((t: string) => makeBuilder(resultsByTable[t] ?? [])) } as never;
}

const START = '2026-06-01T00:00:00.000Z';
const END = '2026-06-30T23:59:59.999Z';

describe('fetchLossReasonAnalyticsData — org-wide (lead-level)', () => {
  it('counts loss reasons from leads, incl. a lead lost WITHOUT any enrollment', async () => {
    const supabase = makeSupabase({
      cadences: [{ id: 'c1', name: 'Cad 1' }],
      cadence_enrollments: [], // nenhum enrollment — antes esvaziava o gráfico
      loss_reasons: [
        { id: 'r1', name: 'Preço' },
        { id: 'r2', name: 'Timing' },
      ],
      leads: [
        { loss_reason_id: 'r1', loss_notes: null, assigned_to: 'u1' },
        { loss_reason_id: 'r1', loss_notes: null, assigned_to: 'u1' },
        { loss_reason_id: 'r2', loss_notes: null, assigned_to: 'u2' },
        // auto-perda por inatividade → excluída
        { loss_reason_id: 'r1', loss_notes: 'Auto-perda por inatividade (30d)', assigned_to: 'u1' },
      ],
    });

    const data = await fetchLossReasonAnalyticsData(supabase, 'org-1', START, END);

    // 3 perdas reais (a auto-perda é excluída), mesmo SEM enrollments.
    expect(data.totalLost).toBe(3);
    expect(data.topReasonName).toBe('Preço');
    expect(data.topReasonCount).toBe(2);

    const r1 = data.reasonsRanking.find((r) => r.reasonId === 'r1');
    const r2 = data.reasonsRanking.find((r) => r.reasonId === 'r2');
    expect(r1?.count).toBe(2);
    expect(r2?.count).toBe(1);

    // Por-SDR também é lead-level (por assigned_to).
    const ana = data.lossByUserStacked.find((u) => u.userId === 'u1');
    expect(ana?.totalLost).toBe(2);
    expect(ana?.userName).toBe('Ana');

    // Taxa de perda = funil de enrollments (0 enrollments → 0).
    expect(data.overallLossRate).toBe(0);
  });
});

describe('fetchLossReasonAnalyticsData — cadence-filtered (enrollment-level)', () => {
  it('uses enrollment-level loss reasons when a cadence is selected', async () => {
    const supabase = makeSupabase({
      cadences: [{ id: 'c1', name: 'Cad 1' }],
      cadence_enrollments: [
        { cadence_id: 'c1', lead_id: 'l1', status: 'completed', loss_reason_id: 'r1', enrolled_by: 'u1' },
        { cadence_id: 'c1', lead_id: 'l2', status: 'completed', loss_reason_id: 'r1', enrolled_by: 'u1' },
        { cadence_id: 'c1', lead_id: 'l3', status: 'active', loss_reason_id: null, enrolled_by: 'u1' },
      ],
      loss_reasons: [{ id: 'r1', name: 'Preço' }],
      leads: [
        { id: 'l1', assigned_to: 'u1' },
        { id: 'l2', assigned_to: 'u1' },
      ],
    });

    const data = await fetchLossReasonAnalyticsData(supabase, 'org-1', START, END, undefined, 'c1');

    expect(data.totalLost).toBe(2); // 2 enrollments perdidos
    expect(data.totalEnrolled).toBe(3);
    expect(data.overallLossRate).toBe(66.7); // 2/3
    expect(data.reasonsRanking[0]?.reasonName).toBe('Preço');
  });
});
