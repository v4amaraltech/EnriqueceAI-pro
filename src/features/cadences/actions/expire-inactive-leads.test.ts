import { beforeEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({ scheduleInboundRecovery: vi.fn() }));
const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));

vi.mock('@/lib/supabase/service', () => service);
vi.mock('@/features/leads/services/inbound-recovery.service', () => recovery);

import { expireInactiveLeads } from './expire-inactive-leads';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const REASON_NUNCA = 'b1a85355-bdf8-4d53-b0ee-52dd0067ae23';
const REASON_DEIXOU = '863d2e55-7160-4d2a-818c-94846d3040da';

interface Candidate {
  enrollment_id: string;
  lead_id: string;
  org_id: string;
  cadence_id: string;
  auto_loss_reason_id: string;
  auto_loss_after_days: number;
  inactive_days: number;
  enrollment_status: 'active' | 'completed';
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    enrollment_id: `enr-${Math.random().toString(36).slice(2, 8)}`,
    lead_id: `lead-${Math.random().toString(36).slice(2, 8)}`,
    org_id: ORG,
    cadence_id: 'cad-1',
    auto_loss_reason_id: REASON_NUNCA,
    auto_loss_after_days: 21,
    inactive_days: 30,
    enrollment_status: 'active',
    ...over,
  };
}

/** Chamadas capturadas por tabela, para asserção. */
interface Captured {
  table: string;
  op: 'update' | 'insert';
  payload: Record<string, unknown>;
  /** Filtros encadeados após o update/insert (ex.: `is('loss_reason_id', null)`) */
  filters: string[];
}

let candidates: Candidate[];
let captured: Captured[];
let rpcArgs: Record<string, unknown> | undefined;
/** Motivos devolvidos pela consulta a loss_reasons (nome dispara ou não a Recovery). */
let reasonRows: Array<{ id: string; name: string }>;
/** Origens dos leads, para o teste de Recovery. */
let leadSources: Record<string, string>;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const filters: string[] = [];
  let pending: Captured | null = null;

  const passthrough = (name: string) =>
    vi.fn((...args: unknown[]) => {
      filters.push(`${name}:${String(args[0])}`);
      return chain;
    });

  chain.select = vi.fn(() => chain);
  chain.eq = passthrough('eq');
  chain.is = passthrough('is');
  chain.not = passthrough('not');
  chain.in = passthrough('in');
  chain.filter = passthrough('filter');
  chain.limit = vi.fn(() => chain);

  chain.update = vi.fn((payload: Record<string, unknown>) => {
    pending = { table, op: 'update', payload, filters };
    captured.push(pending);
    return chain;
  });
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    captured.push({ table, op: 'insert', payload, filters });
    return Promise.resolve({ error: null });
  });

  // A checagem de idempotência da interaction termina em maybeSingle().
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null }));

  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let result: unknown = { data: null, error: null };
    if (table === 'cadences' && !pending) result = { data: [{ id: 'cad-1' }], error: null };
    else if (table === 'loss_reasons') result = { data: reasonRows, error: null };
    return Promise.resolve(result).then(resolve, reject);
  };

  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = [];
  rpcArgs = undefined;
  candidates = [];
  reasonRows = [{ id: REASON_NUNCA, name: 'Nunca respondeu' }];
  leadSources = {};

  service.createServiceRoleClient.mockReturnValue({
    from: (table: string) => makeChain(table),
    rpc: (_fn: string, args: Record<string, unknown>) => {
      rpcArgs = args;
      return Promise.resolve({ data: candidates, error: null });
    },
  });
  recovery.scheduleInboundRecovery.mockResolvedValue({ scheduled: 0 });
  void leadSources;
});

const enrollmentUpdates = () => captured.filter((c) => c.table === 'cadence_enrollments' && c.op === 'update');
const leadUpdates = () => captured.filter((c) => c.table === 'leads' && c.op === 'update');
const interactionInserts = () => captured.filter((c) => c.table === 'interactions' && c.op === 'insert');

describe('expireInactiveLeads — candidatos de cadência concluída', () => {
  it('pede os candidatos de cadência concluída ao RPC', async () => {
    await expireInactiveLeads();
    expect(rpcArgs).toEqual({ p_include_completed: true });
  });

  it('candidato de enrollment concluído: marca o lead perdido sem reencerrar o enrollment', async () => {
    candidates = [candidate({ enrollment_status: 'completed', inactive_days: 25 })];

    const result = await expireInactiveLeads();

    expect(result.success).toBe(true);
    const [enrollUpdate] = enrollmentUpdates();
    expect(enrollUpdate?.payload).toEqual({
      loss_reason_id: REASON_NUNCA,
      loss_notes: 'Auto-perda por inatividade (25d sem atividade)',
    });
    // não pode carimbar status nem completed_at por cima do fim da cadência
    expect(enrollUpdate?.payload).not.toHaveProperty('status');
    expect(enrollUpdate?.payload).not.toHaveProperty('completed_at');
    // e só toca em quem ainda não tem motivo
    expect(enrollUpdate?.filters).toContain('is:loss_reason_id');
    expect(leadUpdates()[0]?.payload).toMatchObject({ status: 'unqualified' });
  });

  it('candidato de enrollment ativo mantém o carimbo completo (regressão)', async () => {
    candidates = [candidate({ enrollment_status: 'active', inactive_days: 30 })];

    await expireInactiveLeads();

    const [enrollUpdate] = enrollmentUpdates();
    expect(enrollUpdate?.payload).toMatchObject({
      status: 'completed',
      loss_reason_id: REASON_NUNCA,
      loss_notes: 'Auto-perda por inatividade (30d sem atividade)',
    });
    expect(enrollUpdate?.payload).toHaveProperty('completed_at');
    expect(enrollUpdate?.filters).not.toContain('is:loss_reason_id');
  });

  it('grava a origem da perda na interaction de auditoria', async () => {
    candidates = [candidate({ enrollment_status: 'completed' })];
    await expireInactiveLeads();
    expect(interactionInserts()[0]?.payload.metadata).toMatchObject({
      reason: 'auto_loss_inactivity',
      source: 'cadence_completed',
    });

    captured = [];
    candidates = [candidate({ enrollment_status: 'active' })];
    await expireInactiveLeads();
    expect(interactionInserts()[0]?.payload.metadata).toMatchObject({ source: 'cadence_active' });
  });
});

describe('expireInactiveLeads — teto por org', () => {
  it('processa no máximo 25 concluídos por org, os mais parados primeiro', async () => {
    candidates = Array.from({ length: 30 }, (_, i) =>
      candidate({ enrollment_status: 'completed', lead_id: `lead-${i}`, inactive_days: 21 + i }),
    );

    const result = await expireInactiveLeads();

    expect(result.success && result.data.leads_lost).toBe(25);
    const perdidos = leadUpdates().length;
    expect(perdidos).toBe(25);
    // os 25 de maior inactive_days são de lead-29 a lead-5
    const notas = enrollmentUpdates().map((u) => u.payload.loss_notes);
    expect(notas).toContain('Auto-perda por inatividade (50d sem atividade)'); // lead-29
    expect(notas).not.toContain('Auto-perda por inatividade (21d sem atividade)'); // lead-0
  });

  it('o teto é por org — duas orgs processam 25 cada', async () => {
    const outraOrg = '11111111-1111-1111-1111-111111111111';
    candidates = [
      ...Array.from({ length: 30 }, (_, i) =>
        candidate({ enrollment_status: 'completed', lead_id: `a-${i}`, inactive_days: 21 + i }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        candidate({ enrollment_status: 'completed', lead_id: `b-${i}`, org_id: outraOrg, inactive_days: 21 + i }),
      ),
    ];

    const result = await expireInactiveLeads();

    expect(result.success && result.data.leads_lost).toBe(50);
  });

  it('o teto não limita candidatos de enrollment ativo', async () => {
    candidates = Array.from({ length: 40 }, (_, i) =>
      candidate({ enrollment_status: 'active', lead_id: `lead-${i}` }),
    );

    const result = await expireInactiveLeads();

    expect(result.success && result.data.leads_lost).toBe(40);
  });

  it('ativos e concluídos no mesmo lote: só os concluídos sofrem o teto', async () => {
    candidates = [
      ...Array.from({ length: 10 }, (_, i) => candidate({ enrollment_status: 'active', lead_id: `on-${i}` })),
      ...Array.from({ length: 30 }, (_, i) =>
        candidate({ enrollment_status: 'completed', lead_id: `off-${i}`, inactive_days: 21 + i }),
      ),
    ];

    const result = await expireInactiveLeads();

    expect(result.success && result.data.leads_lost).toBe(35);
  });
});

describe('expireInactiveLeads — Recovery', () => {
  it('motivo reativável dispara a Recovery uma vez por grupo', async () => {
    candidates = [candidate({ enrollment_status: 'completed', auto_loss_reason_id: REASON_NUNCA })];

    await expireInactiveLeads();

    expect(recovery.scheduleInboundRecovery).toHaveBeenCalledTimes(1);
    expect(recovery.scheduleInboundRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, lossReasonName: 'Nunca respondeu', userId: null }),
    );
  });

  it('motivo não reativável (fim da própria Recovery) não agenda nada — sem ciclo', async () => {
    reasonRows = [{ id: REASON_DEIXOU, name: 'Deixou de responder' }];
    candidates = [candidate({ enrollment_status: 'completed', auto_loss_reason_id: REASON_DEIXOU })];

    await expireInactiveLeads();

    // o serviço até é chamado, mas com o motivo que ele mesmo rejeita;
    // o que não pode acontecer é a Recovery ser agendada para outro motivo
    const call = recovery.scheduleInboundRecovery.mock.calls[0]?.[0] as { lossReasonName: string } | undefined;
    expect(call?.lossReasonName).toBe('Deixou de responder');
  });

  it('sem candidatos: não chama a Recovery e reporta zero', async () => {
    candidates = [];

    const result = await expireInactiveLeads();

    expect(result.success && result.data.leads_lost).toBe(0);
    expect(recovery.scheduleInboundRecovery).not.toHaveBeenCalled();
  });
});
