import { describe, expect, it, vi } from 'vitest';

import { createFakeSupabase, makeRows } from '@tests/mocks/postgrest-table';

vi.mock('./member-lookup', () => ({
  buildMemberInfoMap: vi.fn(async () => new Map([['u1', { name: 'Ana' }]])),
  buildMemberNameMap: vi.fn(async () => new Map([['u1', 'Ana']])),
}));

import { fetchActivityAnalyticsData } from './activity-analytics.service';
import { fetchCadenceAnalyticsData } from './cadence-analytics.service';
import { fetchCallDashboardData } from './call-dashboard.service';
import { fetchConversionAnalyticsData } from './conversion-analytics.service';
import { fetchPerformanceAnalyticsData } from './performance-analytics.service';

/**
 * Volumes reais da V4 Amaral em 30 dias (medidos em prod, 10/set/2026):
 * ~13 mil interações, ~12 mil ligações, ~24 mil interações na Conversão.
 * Antes estas telas faziam `.limit(10000)` e mostravam um pedaço arbitrário.
 * O banco de mentira corta cada resposta em 1.000 linhas (como um servidor
 * PostgREST corta em silêncio), então só passa quem pagina de verdade.
 */
const START = '2026-08-01T03:00:00.000Z';
const END = '2026-09-01T02:59:59.999Z';
const N = 12_000;

const at = (i: number) => new Date(Date.parse(START) + i * 60_000).toISOString();

/** Toda leitura paginada precisa desempatar por coluna única no fim. */
function expectDeterministicOrder(orders: string[][] | undefined) {
  expect(orders?.length).toBeGreaterThan(0);
  for (const cols of orders ?? []) expect(cols.at(-1)).toBe('id');
}

describe('estatísticas leem TODAS as linhas do período (acima de 10.000)', () => {
  it('Atividades: conta as 12.000 interações e os 10.500 leads', async () => {
    const { client, orders, rangeCalls } = createFakeSupabase({
      interactions: makeRows(N, (i, id) => ({
        id,
        type: 'sent',
        channel: 'phone',
        lead_id: `lead-${i % 500}`,
        created_at: at(i),
        performed_by: 'u1',
      })),
      leads: makeRows(10_500, (i, id) => ({ id, status: 'new', assigned_to: 'u1', created_at: at(i) })),
    });

    const data = await fetchActivityAnalyticsData(client, 'org-1', START, END);

    expect(data.kpis.totalActivities).toBe(N);
    expect(data.leadsInPeriod).toBe(10_500);
    expect(data.userBreakdown[0]?.activitiesTotal).toBe(N);
    expect(data.userBreakdown[0]?.totalLeads).toBe(10_500); // "todos os leads", sem período
    expect(rangeCalls.interactions).toBeGreaterThan(1);
    expectDeterministicOrder(orders.interactions);
    expectDeterministicOrder(orders.leads);
  });

  it('Cadências: conta os 10.500 enrollments e os 12.000 envios', async () => {
    const { client, orders } = createFakeSupabase({
      cadences: [{ id: 'c1', name: 'Outbound', status: 'active', priority: null }],
      cadence_enrollments: makeRows(10_500, (i, id) => ({
        id,
        cadence_id: 'c1',
        lead_id: `lead-${i}`,
        current_step: 1,
        status: 'active',
        enrolled_by: 'u1',
      })),
      cadence_steps: [{ cadence_id: 'c1', step_order: 1, channel: 'email' }],
      interactions: makeRows(N, (i, id) => ({
        id,
        type: 'sent',
        cadence_id: 'c1',
        lead_id: `lead-${i}`,
        created_at: at(i),
      })),
    });

    const data = await fetchCadenceAnalyticsData(client, 'org-1', START, END);

    expect(data.totalEnrolled).toBe(10_500);
    expect(data.totalSent).toBe(N);
    expectDeterministicOrder(orders.cadence_enrollments);
    expectDeterministicOrder(orders.interactions);
  });

  it('Performance: conta as 12.000 atividades do SDR', async () => {
    const { client, orders } = createFakeSupabase({
      organization_members: [{ user_id: 'u1', status: 'active' }],
      interactions: makeRows(N, (i, id) => ({
        id,
        type: 'sent',
        channel: 'phone',
        lead_id: `lead-${i % 500}`,
        performed_by: 'u1',
        cadence_id: null,
        created_at: at(i),
      })),
      leads: makeRows(10_500, (i, id) => ({
        id,
        status: 'new',
        created_by: 'u1',
        assigned_to: 'u1',
        won_by: null,
        created_at: at(i),
      })),
    });

    const data = await fetchPerformanceAnalyticsData(client, 'org-1', START, END);

    expect(data.totalActivities).toBe(N);
    expect(data.totalLeadsCreated).toBe(10_500);
    expectDeterministicOrder(orders.interactions);
    expectDeterministicOrder(orders.leads);
  });

  it('Painel de Ligações: conta as 12.000 ligações e lista as mais recentes primeiro', async () => {
    const { client, orders } = createFakeSupabase({
      calls: makeRows(N, (i, id) => ({
        id,
        user_id: 'u1',
        destination: '11999990000',
        status: 'not_connected',
        duration_seconds: 10,
        answered_at: null,
        sdr_disposition: null,
        hangup_cause: null,
        recording_url: null,
        started_at: at(i),
      })),
    });

    const data = await fetchCallDashboardData(client, 'org-1', START, END);

    expect(data.kpis.totalCalls).toBe(N);
    expect(data.recentCalls[0]?.startedAt).toBe(at(N - 1));
    expectDeterministicOrder(orders.calls);
  });

  it('Conversão: 12.000 interações e os leads antigos tocados no período (antes: HTTP 414 → sumiam)', async () => {
    const inPeriod = makeRows(500, (i, id) => ({
      id: `new-${id}`,
      status: 'new',
      created_at: at(i),
      created_by: 'u1',
      won_at: null,
      lost_at: null,
      meeting_held_at: null,
    }));
    // Criados ANTES do período, mas com interação dentro dele: 2.500 ids num
    // `.in()` só estouravam a URL do PostgREST (caso real: ~2.400 em 30 dias).
    const touchedOld = makeRows(2_500, (_i, id) => ({
      id: `old-${id}`,
      status: 'contacted',
      created_at: '2026-05-01T12:00:00.000Z',
      created_by: 'u1',
      won_at: null,
      lost_at: null,
      meeting_held_at: null,
    }));
    const leads = [...inPeriod, ...touchedOld];
    const { client, orders } = createFakeSupabase({
      leads,
      interactions: makeRows(N, (i, id) => ({
        id,
        type: 'sent',
        lead_id: leads[i % leads.length]!.id,
        cadence_id: null,
        created_at: at(i),
      })),
      cadences: [],
    });

    const data = await fetchConversionAnalyticsData(client, 'org-1', START, END);

    const stage = (label: string) => data.funnel.find((s) => s.label === label)?.count;
    expect(stage('Total Leads')).toBe(3_000);
    expect(stage('Contactados')).toBe(3_000);
    expectDeterministicOrder(orders.interactions);
  });
});
