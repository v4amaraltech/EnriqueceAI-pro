import { describe, expect, it, vi } from 'vitest';

import { createFakeSupabase, makeRows } from '@tests/mocks/postgrest-table';

import { fetchActivityAnalyticsData } from './activity-analytics.service';
import { fetchCadenceAnalyticsData } from './cadence-analytics.service';
import { fetchCallDashboardData } from './call-dashboard.service';
import { fetchConversionAnalyticsData } from './conversion-analytics.service';
import { fetchPerformanceAnalyticsData } from './performance-analytics.service';

vi.mock('./member-lookup', () => ({
  buildMemberInfoMap: vi.fn(async () => new Map([['u1', { name: 'Ana' }]])),
  buildMemberNameMap: vi.fn(async () => new Map([['u1', 'Ana']])),
}));

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
      leads: makeRows(10_500, (i, id) => ({
        id,
        status: 'new',
        assigned_to: 'u1',
        created_at: at(i),
      })),
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

  it('Conversão: lê o universo inteiro do RPC em páginas, ordenado por lead', async () => {
    // O servidor corta em 1.000 por resposta; o universo tem 3.000 leads.
    const universe = makeRows(3_000, (i, id) => ({
      lead_id: id,
      status: 'contacted',
      created_by: null,
      won_at: null,
      has_sent: i % 3 !== 0,
      has_meeting_scheduled: i % 100 === 0,
      has_replied: false,
      enrollments: [],
    }));
    const { client, orders, rangeCalls, rpcCalls } = createFakeSupabase({
      'rpc:get_conversion_universe': universe,
      cadences: [],
    });

    const data = await fetchConversionAnalyticsData(client, 'org-1', START, END, [], 'nao-e-uuid');

    const stage = (label: string) => data.funnel.find((s) => s.label === label)?.count;
    expect(stage('Total Leads')).toBe(3_000);
    expect(stage('Contactados')).toBe(2_000);
    expect(stage('Qualificados')).toBe(30);
    expect(rangeCalls['rpc:get_conversion_universe']).toBeGreaterThan(1);
    // `lead_id` é único no universo → ordem determinística entre páginas.
    expect(orders['rpc:get_conversion_universe']?.every((cols) => cols.join() === 'lead_id')).toBe(
      true,
    );
    // Filtro vazio e cadência inválida não vão para o banco (DEFAULT NULL).
    expect(rpcCalls[0]).toEqual({
      name: 'get_conversion_universe',
      args: { p_start: START, p_end: END },
    });
  });

  it('Conversão: filtros de SDR e de cadência vão como parâmetros do RPC', async () => {
    const { client, rpcCalls } = createFakeSupabase({
      'rpc:get_conversion_universe': [],
      cadences: [],
    });
    const cad = '15a05299-1627-40d1-be81-80150a4f1308';

    await fetchConversionAnalyticsData(client, 'org-1', START, END, ['u1', 'u2'], cad);

    expect(rpcCalls[0]?.args).toEqual({
      p_start: START,
      p_end: END,
      p_user_ids: ['u1', 'u2'],
      p_cadence_id: cad,
    });
  });
});
