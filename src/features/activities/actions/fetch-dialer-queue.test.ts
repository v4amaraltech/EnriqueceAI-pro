import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

// Cada tabela devolve um "builder" encadeável que, ao ser aguardado, resolve com
// os dados configurados no teste.
const tableData: Record<string, unknown> = {};

function chainFor(table: string) {
  const result = () => ({ data: tableData[table] ?? null, error: null });
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'lte', 'in', 'order', 'limit', 'gte', 'not', 'is']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result()));
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(() =>
    Promise.resolve({ success: true, data: { orgId: 'org-1', userId: 'user-1', role: 'manager', supabase: {} } }),
  ),
}));

vi.mock('@/lib/supabase/from', () => ({
  from: vi.fn((_supabase: unknown, table: string) => chainFor(table)),
}));

vi.mock('@/lib/supabase/chunked-in', () => ({
  chunkedIn: vi.fn(() => Promise.resolve(tableData.calls ?? [])),
}));

vi.mock('@/features/contact-engine/services/call-priority.service', () => ({
  isCallPriorityV2Enabled: vi.fn(() => Promise.resolve(false)),
}));

import { isCallPriorityV2Enabled } from '@/features/contact-engine/services/call-priority.service';

import { fetchDialerQueue, fetchDialerQueueWithStats } from './fetch-dialer-queue';

function lead(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    nome_fantasia: `Lead ${id}`,
    razao_social: null,
    cnpj: '00000000000000',
    telefone: null,
    first_name: null,
    last_name: null,
    socios: null,
    phones: null,
    ...extra,
  };
}

function enrollment(id: string, leadData: ReturnType<typeof lead>, cadence: Record<string, unknown> = {}, currentStep = 1) {
  return {
    id,
    cadence_id: (cadence.id as string) ?? 'cad-1',
    lead_id: leadData.id,
    current_step: currentStep,
    next_step_due: '2026-11-06T09:00:00Z',
    lead: leadData,
    cadence: { id: 'cad-1', name: 'Cadência', type: 'standard', executor: null, ...cadence },
  };
}

describe('fetchDialerQueueWithStats', () => {
  beforeEach(() => {
    for (const k of Object.keys(tableData)) delete tableData[k];
    tableData.organization_call_settings = { dialer_daily_limit_per_lead: 2 };
    tableData.cadence_steps = [
      { id: 'step-1', cadence_id: 'cad-1', step_order: 1, channel: 'phone', activity_name: 'Ligar', instructions: null },
      { id: 'step-2', cadence_id: 'cad-1', step_order: 2, channel: 'email', activity_name: null, instructions: null },
    ];
    vi.mocked(isCallPriorityV2Enabled).mockResolvedValue(false);
  });

  it('conta os leads fora da fila com a mesma regra que monta a fila', async () => {
    tableData.cadence_enrollments = [
      // Telefone no campo principal → entra
      enrollment('e1', lead('l1', { telefone: '11999990001' })),
      // Telefone SÓ na lista de telefones → entra (antes o card contava como "sem telefone")
      enrollment('e2', lead('l2', { phones: [{ tipo: 'celular', numero: '11999990002' }] })),
      // Etapa atual é e-mail, mas a cadência tem ligação → entra (antes o card ignorava)
      enrollment('e3', lead('l3', { telefone: '11999990003' }), {}, 2),
      // Sem nenhum telefone → fora da fila
      enrollment('e4', lead('l4')),
      // Único número já ligado 2x hoje (limite 2, por número) → fora da fila
      enrollment('e5', lead('l5', { telefone: '11999990005' })),
      // Um número no limite, o outro não → continua na fila
      enrollment('e7', lead('l7', { telefone: '11999990007', phones: [{ tipo: 'celular', numero: '11999990077' }] })),
      // Cadência da IA → nem entra na conta
      enrollment('e6', lead('l6'), { executor: 'bdr_ai' }),
    ];
    const call = (leadId: string, destination: string) => ({ lead_id: leadId, destination, started_at: '2026-11-06T12:00:00Z' });
    tableData.calls = [
      call('l5', '5511999990005'),
      call('l5', '11999990005'),
      call('l1', '11999990001'),
      call('l7', '11999990007'),
      call('l7', '11999990007'),
    ];

    const result = await fetchDialerQueueWithStats();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items.map((i) => i.leadId)).toEqual(['l1', 'l2', 'l3', 'l7']);
    expect(result.data.stats).toEqual({
      leadsWithoutPhone: 1,
      leadsAtDailyLimit: 1,
      leadsWithSnooze: 0,
      totalAvailable: 4,
    });
  });

  it('"Total disponível" é sempre o tamanho da fila', async () => {
    tableData.cadence_enrollments = [
      enrollment('e1', lead('l1', { telefone: '11999990001' })),
      enrollment('e2', lead('l2', { telefone: '11999990002' })),
    ];

    const [withStats, queue] = await Promise.all([fetchDialerQueueWithStats(), fetchDialerQueue()]);

    expect(withStats.success && queue.success).toBe(true);
    if (!withStats.success || !queue.success) return;
    expect(withStats.data.stats.totalAvailable).toBe(queue.data.length);
  });

  it('sem inscrições, devolve fila vazia e tudo zero', async () => {
    tableData.cadence_enrollments = [];

    const result = await fetchDialerQueueWithStats();

    expect(result).toEqual({
      success: true,
      data: { items: [], stats: { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 }, priorityQueueEnabled: false },
    });
  });

  it('com a flag desligada, mantém a ordem por next_step_due mesmo com resposta', async () => {
    const early = enrollment('e1', lead('l1', { telefone: '11999990001' }));
    early.next_step_due = '2026-11-01T09:00:00Z';
    const later = enrollment('e2', lead('l2', { telefone: '11999990002' }));
    later.next_step_due = '2026-11-10T09:00:00Z';
    tableData.cadence_enrollments = [early, later];
    tableData.interactions = [{ lead_id: 'l2', type: 'replied', created_at: '2026-11-13T12:00:00Z' }];
    tableData.leads = [
      { id: 'l1', updated_at: '2026-11-01T00:00:00Z', meeting_no_show_at: null },
      { id: 'l2', updated_at: '2026-11-13T00:00:00Z', meeting_no_show_at: null },
    ];

    const result = await fetchDialerQueueWithStats();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.priorityQueueEnabled).toBe(false);
    expect(result.data.items.map((i) => i.leadId)).toEqual(['l1', 'l2']);
  });

  it('com a flag ligada, sobe resposta, no-show e abertura na frente da cadência atrasada', async () => {
    // Relógio fixo: a resposta (13/11) só prioriza por 7 dias. Com o relógio real o teste quebrava a partir de 20/11.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    vi.mocked(isCallPriorityV2Enabled).mockResolvedValue(true);
    const overdue = enrollment('e1', lead('l1', { telefone: '11999990001' }));
    overdue.next_step_due = '2026-11-01T09:00:00Z';
    const opened = enrollment('e2', lead('l2', { telefone: '11999990002' }));
    opened.next_step_due = '2026-11-12T09:00:00Z';
    const noShow = enrollment('e3', lead('l3', { telefone: '11999990003' }));
    noShow.next_step_due = '2026-11-12T12:00:00Z';
    const replied = enrollment('e4', lead('l4', { telefone: '11999990004' }));
    replied.next_step_due = '2026-11-13T09:00:00Z';
    tableData.cadence_enrollments = [overdue, opened, noShow, replied];
    tableData.interactions = [
      { lead_id: 'l4', type: 'replied', created_at: '2026-11-13T18:00:00Z' },
      { lead_id: 'l2', type: 'opened', created_at: '2026-11-13T18:00:00Z' },
    ];
    tableData.leads = [
      { id: 'l1', updated_at: '2026-11-01T00:00:00Z', meeting_no_show_at: null },
      { id: 'l2', updated_at: '2026-11-12T00:00:00Z', meeting_no_show_at: null },
      { id: 'l3', updated_at: '2026-11-10T00:00:00Z', meeting_no_show_at: '2026-11-10T12:00:00Z' },
      { id: 'l4', updated_at: '2026-11-13T00:00:00Z', meeting_no_show_at: null },
    ];

    const result = await fetchDialerQueueWithStats();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.priorityQueueEnabled).toBe(true);
    expect(result.data.items.map((i) => i.leadId)).toEqual(['l4', 'l3', 'l2', 'l1']);
  });
});
