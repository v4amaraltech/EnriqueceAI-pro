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
  const scheduledChain = createChainMock({ count: 4, error: null });
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
      if (table === 'leads') return leadsCalls++ === 0 ? scheduledChain : heldChain;
      if (table === 'calls') return callsChain;
      if (table === 'goals_per_user') return goalsChain;
      return createChainMock();
    }),
    rpc: vi.fn(() =>
      Promise.resolve({
        data: [
          { performer_id: 'other-sdr', cnt: 50 },
          { performer_id: SDR, cnt: 91 },
        ],
        error: null,
      }),
    ),
  };
  return { supabase, scheduledChain, heldChain, callsChain, goalsChain };
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

  it('reuniões: contagem exata (head) atribuída ao dono do lead', async () => {
    const { supabase, scheduledChain, heldChain } = setup();
    await fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', SDR);

    expect(scheduledChain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(scheduledChain.eq).toHaveBeenCalledWith('assigned_to', SDR);
    expect(scheduledChain.neq).toHaveBeenCalledWith('status', 'archived');
    expect(heldChain.eq).toHaveBeenCalledWith('assigned_to', SDR);
    expect(heldChain.not).toHaveBeenCalledWith('meeting_held_at', 'is', null);
  });

  it('leads abertos: usa a RPC do ranking e pega só o SDR pedido (0 se ausente)', async () => {
    const { supabase } = setup();
    const other = await fetchSdrPaceMetrics(supabase as never, ORG, '2026-09', 'sem-leads');
    expect(other.actual.leadsOpened).toBe(0);
    expect(supabase.rpc).toHaveBeenCalledWith('count_leads_opened_by_sdr', {
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
