import { describe, expect, it, vi } from 'vitest';

import { fetchSdrIds, fetchSdrPaceMetrics } from './sdr-pace.service';

// --- Chainable + thenable mock builder (mesmo padrão de ranking-metrics.service.test) ---
function createChainMock(finalResult: unknown = { data: null }) {
  const chain: Record<string, unknown> = {};
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(finalResult).then(resolve);
  for (const method of ['select', 'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(finalResult));
  return chain;
}

/** Chain de `calls` paginada: 1ª página com as linhas, depois vazia. */
function createPagedChain(rows: unknown[]) {
  const chain = createChainMock();
  chain.range = vi.fn((from: number) => Promise.resolve({ data: from === 0 ? rows : [], error: null }));
  return chain;
}

const ORG = 'org-1';
const SDR = 'sdr-1';

function call(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    status: 'significant',
    duration_seconds: 120,
    answered_at: '2026-09-10T15:00:00Z',
    sdr_disposition: null,
    hangup_cause: 'NORMAL_CLEARING',
    recording_url: null,
    ...overrides,
  };
}

function setup() {
  // Marcadas = eventos da timeline: 4 marcações em 3 leads do SDR (l2 remarcado noutro
  // dia) + 1 de outro SDR + 1 no mesmo dia de l1 (dedup) → 4 para o SDR.
  const membersChain = createChainMock({ data: [{ user_id: SDR }, { user_id: 'other-sdr' }] });
  const eventsChain = createChainMock({
    data: [
      { lead_id: 'l1', created_at: '2026-09-02T12:00:00Z', metadata: { start_time: '2026-09-04T10:00:00' } },
      { lead_id: 'l1', created_at: '2026-09-02T15:00:00Z', metadata: { start_time: '2026-09-04T11:00:00' } },
      { lead_id: 'l2', created_at: '2026-09-03T12:00:00Z', metadata: null },
      { lead_id: 'l2', created_at: '2026-09-10T12:00:00Z', metadata: null },
      { lead_id: 'l3', created_at: '2026-09-11T12:00:00Z', metadata: null },
      { lead_id: 'l9', created_at: '2026-09-11T12:00:00Z', metadata: null },
    ],
  });
  const scheduledChain = createChainMock({
    data: [
      { id: 'l1', razao_social: 'L1', nome_fantasia: null, assigned_to: SDR, meeting_starts_at: null },
      { id: 'l2', razao_social: 'L2', nome_fantasia: null, assigned_to: SDR, meeting_starts_at: null },
      { id: 'l3', razao_social: 'L3', nome_fantasia: null, assigned_to: SDR, meeting_starts_at: null },
      { id: 'l9', razao_social: 'L9', nome_fantasia: null, assigned_to: 'other-sdr', meeting_starts_at: null },
    ],
  });
  const heldChain = createChainMock({ count: 3, error: null });
  let leadsCalls = 0;
  const callsChain = createPagedChain([
    call(), // conectada
    call({ duration_seconds: 49 }), // curta demais
    call({ answered_at: null, duration_seconds: 300 }), // sem atendimento
    call({ sdr_disposition: 'voicemail' }), // caixa postal
    call({ duration_seconds: 50 }), // piso exato → conectada
  ]);
  const goalsChain = createChainMock({
    data: {
      leads_opened_target: 300,
      meetings_scheduled_target: 20,
      meetings_held_target: 15,
      calls_target: 2200,
      calls_connected_target: 176,
    },
  });

  const supabase = {
    from: vi.fn((table: string) => {
      // held consulta leads de cara; marcadas só depois de ler membros e eventos.
      if (table === 'leads') return leadsCalls++ === 0 ? heldChain : scheduledChain;
      if (table === 'organization_members') return membersChain;
      if (table === 'interactions') return eventsChain;
      if (table === 'calls') return callsChain;
      if (table === 'goals_per_user') return goalsChain;
      return createChainMock();
    }),
    // Uma linha por abertura (other-sdr=50, SDR=91).
    rpc: vi.fn(() =>
      Promise.resolve({
        data: [
          ...Array.from({ length: 50 }, () => ({ performer_id: 'other-sdr', opened_at: '2026-09-02T13:00:00Z' })),
          ...Array.from({ length: 91 }, () => ({ performer_id: SDR, opened_at: '2026-09-03T13:00:00Z' })),
        ],
        error: null,
      }),
    ),
  };
  return { supabase, scheduledChain, eventsChain, heldChain, callsChain, goalsChain };
}

describe('fetchSdrPaceMetrics', () => {
  it('monta realizado × meta do SDR no mês', async () => {
    const { supabase } = setup();
    const result = await fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', SDR);

    expect(result).toEqual({
      actual: { leadsOpened: 91, meetingsScheduled: 4, meetingsHeld: 3, calls: 5, callsConnected: 2 },
      target: { leadsOpened: 300, meetingsScheduled: 20, meetingsHeld: 15, calls: 2200, callsConnected: 176 },
    });
  });

  it('ligações: só outbound do SDR, no mês BRT, com paginação determinística', async () => {
    const { supabase, callsChain } = setup();
    await fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', SDR);

    expect(callsChain.eq).toHaveBeenCalledWith('org_id', ORG);
    expect(callsChain.eq).toHaveBeenCalledWith('user_id', SDR);
    expect(callsChain.eq).toHaveBeenCalledWith('type', 'outbound');
    expect(callsChain.gte).toHaveBeenCalledWith('started_at', '2026-09-01T03:00:00Z');
    expect(callsChain.lt).toHaveBeenCalledWith('started_at', '2026-09-30T23:59:59-03:00');
    expect(callsChain.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('reuniões: marcadas pela fonte do card (eventos, dono do lead); realizadas por contagem exata (head)', async () => {
    const { supabase, scheduledChain, eventsChain, heldChain } = setup();
    await fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', SDR);

    expect(eventsChain.eq).toHaveBeenCalledWith('type', 'meeting_scheduled');
    expect(eventsChain.gte).toHaveBeenCalledWith('created_at', '2026-09-01T03:00:00Z');
    expect(eventsChain.lt).toHaveBeenCalledWith('created_at', '2026-09-30T23:59:59-03:00');
    expect(scheduledChain.neq).toHaveBeenCalledWith('status', 'archived');
    expect(scheduledChain.in).toHaveBeenCalledWith('id', ['l1', 'l2', 'l3', 'l9']);
    expect(heldChain.eq).toHaveBeenCalledWith('assigned_to', SDR);
    expect(heldChain.not).toHaveBeenCalledWith('meeting_held_at', 'is', null);
  });

  it('leads abertos: usa a mesma fonte do ranking e pega só o SDR pedido (0 se ausente)', async () => {
    const { supabase } = setup();
    const other = await fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', 'sem-leads');
    expect(other.actual.leadsOpened).toBe(0);
    expect(supabase.rpc).toHaveBeenCalledWith('count_leads_opened_by_sdr_daily', {
      p_org_id: ORG,
      p_start: '2026-09-01T03:00:00Z',
      p_end: '2026-09-30T23:59:59-03:00',
      p_cadence_ids: null,
    });
  });

  it('sem linha em goals_per_user → metas 0', async () => {
    const { supabase, goalsChain } = setup();
    (goalsChain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
    const result = await fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', SDR);
    expect(result.target).toEqual({ leadsOpened: 0, meetingsScheduled: 0, meetingsHeld: 0, calls: 0, callsConnected: 0 });
  });

  it('erro ao ler as metas propaga (não vira "sem meta")', async () => {
    const { supabase, goalsChain } = setup();
    (goalsChain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'column goals_per_user.calls_target does not exist' },
    });
    await expect(fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', SDR)).rejects.toThrow('calls_target');
  });

  it('erro da RPC de leads abertos propaga (a action mostra a mensagem)', async () => {
    const { supabase } = setup();
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never);
    await expect(fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', SDR)).rejects.toThrow('boom');
  });
});

describe('fetchSdrIds', () => {
  it('só SDRs ativos ou convidados', async () => {
    const chain = createChainMock({ data: [{ user_id: 'a' }, { user_id: 'b' }] });
    const supabase = { from: vi.fn(() => chain) };
    await expect(fetchSdrIds(supabase as never, ORG)).resolves.toEqual(['a', 'b']);
    expect(chain.eq).toHaveBeenCalledWith('role', 'sdr');
    expect(chain.in).toHaveBeenCalledWith('status', ['active', 'invited']);
  });
});
