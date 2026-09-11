import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { interactionCountsReference } from '@tests/helpers/statistics-references';
import { createFakeSupabase } from '@tests/mocks/postgrest-table';

import { fetchActivityAnalyticsData } from './activity-analytics.service';
import { fetchPerformanceAnalyticsData } from './performance-analytics.service';

vi.mock('./member-lookup', () => ({
  buildMemberInfoMap: vi.fn(
    async () =>
      new Map(
        ['u1', 'u2', 'u3'].map((id) => [id, { email: `${id}@x.com`, name: id.toUpperCase() }]),
      ),
  ),
  buildMemberNameMap: vi.fn(async () => new Map()),
}));

/**
 * Trava de equivalência (story activity-performance-analytics-rpc).
 *
 * O retrato (`__snapshots__`) foi gerado pelo código ANTERIOR, que lia as
 * interações linha a linha. O código novo lê as contagens do RPC
 * `get_interaction_counts` — aqui simulado por `interactionCountsReference`
 * (tests/helpers), a mesma referência que o teste de integração compara com a
 * SQL de verdade. Se as telas mudarem qualquer número com os mesmos dados,
 * este teste quebra.
 */

// ── Dados sintéticos determinísticos ────────────────────────────────────────
let seed = 42;
const rand = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
  return seed / 2 ** 31;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-28T15:00:00.000Z'; // quinta, 12h BRT
const START = '2026-08-01T03:00:00.000Z';
const END = '2026-08-29T02:59:59.999Z'; // inclui "hoje"
const CHANNELS = [
  'email',
  'whatsapp',
  'phone',
  'research',
  'linkedin',
  'calendar',
  'system',
] as const;
const TYPES = [
  'sent',
  'delivered',
  'opened',
  'clicked',
  'replied',
  'meeting_scheduled',
  'failed',
] as const;
// u4 fez atividades mas não é membro ativo; null = sem autor (automação).
const PERFORMERS = ['u1', 'u1', 'u2', 'u2', 'u3', 'u4', null] as const;

type Interaction = {
  id: string;
  type: string;
  channel: string;
  lead_id: string;
  performed_by: string | null;
  cadence_id: string | null;
  created_at: string;
};

const interactions: Interaction[] = Array.from({ length: 1_500 }, (_, i) => {
  // espalha pelo mês e força horários 00h–03h UTC (dia anterior em Brasília)
  const day = Math.floor(rand() * 32) - 2; // inclui alguns fora do período
  const hour = rand() < 0.2 ? Math.floor(rand() * 3) : Math.floor(rand() * 24);
  const at = new Date(
    Date.UTC(2026, 7, 1 + day, hour, Math.floor(rand() * 60), Math.floor(rand() * 60)),
  );
  return {
    id: `i-${String(i).padStart(5, '0')}`,
    type: pick(TYPES),
    channel: pick(CHANNELS),
    lead_id: `lead-${Math.floor(rand() * 120)}`,
    performed_by: pick(PERFORMERS),
    cadence_id: pick([C1, C2, null] as const),
    created_at: at.toISOString(),
  };
});

const leads = Array.from({ length: 120 }, (_, i) => ({
  id: `lead-${i}`,
  status: pick(['new', 'contacted', 'qualified', 'won', 'unqualified'] as const),
  assigned_to: pick(['u1', 'u2', 'u3', null] as const),
  created_by: pick(['u1', 'u2', null] as const),
  won_by: null,
  created_at: new Date(Date.UTC(2026, 7, 1 + Math.floor(rand() * 40) - 10, 12)).toISOString(),
  won_at:
    rand() < 0.2
      ? new Date(Date.UTC(2026, 7, 1 + Math.floor(rand() * 28), 12)).toISOString()
      : null,
  lost_at:
    rand() < 0.2
      ? new Date(Date.UTC(2026, 7, 1 + Math.floor(rand() * 28), 12)).toISOString()
      : null,
}));

const members = ['u1', 'u2', 'u3'].map((user_id) => ({ user_id, status: 'active' }));

function supabase() {
  return createFakeSupabase(
    { interactions, leads, organization_members: members, daily_activity_goals: [] },
    {
      rpc: { get_interaction_counts: (args) => interactionCountsReference(interactions, args) },
      serverCap: 100,
    },
  );
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => {
  vi.useRealTimers();
});

describe('Atividades e Performance — mesmos números com os mesmos dados', () => {
  it('Atividades, sem filtro', async () => {
    const data = await fetchActivityAnalyticsData(supabase().client, 'org-1', START, END);
    expect(data).toMatchSnapshot();
  });

  it('Atividades, filtro de 2 SDRs', async () => {
    const data = await fetchActivityAnalyticsData(supabase().client, 'org-1', START, END, [
      'u1',
      'u4',
    ]);
    expect(data).toMatchSnapshot();
  });

  it('Performance, todos os membros', async () => {
    const data = await fetchPerformanceAnalyticsData(supabase().client, 'org-1', START, END);
    expect(data).toMatchSnapshot();
  });

  it('Performance, 1 SDR e cadência c1', async () => {
    const data = await fetchPerformanceAnalyticsData(
      supabase().client,
      'org-1',
      START,
      END,
      ['u2'],
      C1,
    );
    expect(data).toMatchSnapshot();
  });
});
