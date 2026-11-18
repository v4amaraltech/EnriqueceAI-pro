import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const service = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));
vi.mock('@/lib/supabase/service', () => service);

import { fetchPendingActivities } from './fetch-pending-activities';

const mockFrom = mockSupabaseFrom as ReturnType<typeof vi.fn>;

const V4 = 'org-v4';
const OTHER = 'org-other';
// Quarta 18/11/2026 14:00 BRT (dentro da janela do robô).
const NOW = new Date('2026-11-18T17:00:00Z');
const DUE_RECENT = '2026-11-18T16:30:00Z'; // 13:30 BRT: 30 min
const DUE_OLD = '2026-11-18T13:00:00Z'; // 10:00 BRT: 4 h

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'not', 'lte', 'in', 'order']) c[m] = vi.fn(() => c);
  c.limit = vi.fn(() => Promise.resolve(result));
  c.single = vi.fn(() => Promise.resolve(result));
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

interface Scenario {
  org?: string;
  cadence?: Record<string, unknown>;
  channel?: string;
  due?: string;
  flag?: { enabled: boolean; allow_org_ids: string[]; allow_user_ids: string[] } | null;
  gmail?: Array<Record<string, unknown>>;
}

async function run(s: Scenario = {}) {
  const org = s.org ?? V4;
  const lead = {
    id: 'lead-1', org_id: org, nome_fantasia: 'ABC', razao_social: 'ABC', cnpj: '1', email: 'a@abc.com',
    telefone: '11999990000', status: 'new', assigned_to: 'sdr-1', whatsapp_invalid_at: null, email_bounced_at: null,
  };
  const enrollment = {
    id: 'enr-1', cadence_id: 'cad-1', lead_id: 'lead-1', current_step: 1, status: 'active',
    next_step_due: s.due ?? DUE_RECENT, lead,
    cadence: { id: 'cad-1', name: 'Mista', total_steps: 3, created_by: 'creator-1', type: 'standard', executor: 'human', ...(s.cadence ?? {}) },
  };
  const step = {
    id: 'step-1', cadence_id: 'cad-1', step_order: 1, channel: s.channel ?? 'email', template_id: null,
    delay_days: 0, delay_hours: 0, ai_personalization: false, created_at: '2026-01-01T00:00:00Z',
  };
  const flag = s.flag === undefined ? { enabled: false, allow_org_ids: [V4], allow_user_ids: [] } : s.flag;
  const gmail = s.gmail ?? [{ org_id: org, user_id: 'sdr-1', daily_cap: null, paused_reason: null, created_at: '2026-10-01T00:00:00Z' }];
  service.createServiceRoleClient.mockReturnValue({
    from: (table: string) => (table === 'app_flags' ? chain({ data: flag, error: null }) : chain({ data: gmail, error: null })),
  });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'organization_members') return chain({ data: { org_id: org }, error: null });
    if (table === 'cadence_enrollments') return chain({ data: [enrollment], error: null });
    if (table === 'cadence_steps') return chain({ data: [step], error: null });
    return chain({ data: [], error: null });
  });
  const res = await fetchPendingActivities();
  if (!res.success) throw new Error(res.error);
  return res.data;
}

describe('fila do SDR × e-mail enviado pelo robô (cadência mista)', () => {
  beforeEach(() => {
    resetMocks();
    service.createServiceRoleClient.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('org na flag + e-mail standard + caixa ok: escondido', async () => {
    expect(await run()).toHaveLength(0);
  });

  it('caixa do dono em erro (sem Gmail conectado) e criador também: visível', async () => {
    expect(await run({ gmail: [] })).toHaveLength(1);
  });

  it('caixa em pausa: visível', async () => {
    const paused = [{ org_id: V4, user_id: 'sdr-1', daily_cap: null, paused_reason: 'bounce_rate', created_at: '2026-10-01T00:00:00Z' }];
    expect(await run({ gmail: paused })).toHaveLength(1);
  });

  it('dono sem Gmail mas criador da cadência com Gmail: escondido (mesmo remetente do robô)', async () => {
    const creator = [{ org_id: V4, user_id: 'creator-1', daily_cap: null, paused_reason: null, created_at: '2026-10-01T00:00:00Z' }];
    expect(await run({ gmail: creator })).toHaveLength(0);
  });

  it('vencido há mais de 2 h com a janela aberta: visível (rede de segurança)', async () => {
    expect(await run({ due: DUE_OLD })).toHaveLength(1);
  });

  it('vencido de noite, robô só envia às 8h: continua escondido até 2 h depois da abertura', async () => {
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z')); // 9:00 BRT
    expect(await run({ due: '2026-11-18T01:00:00Z' })).toHaveLength(0); // venceu 22:00 BRT
    vi.setSystemTime(new Date('2026-11-18T14:00:00Z')); // 11:00 BRT (3 h após 8h)
    expect(await run({ due: '2026-11-18T01:00:00Z' })).toHaveLength(1);
  });

  it('org fora da flag: visível', async () => {
    expect(await run({ org: OTHER })).toHaveLength(1);
  });

  it('flag desligada ou ausente: tudo visível', async () => {
    expect(await run({ flag: { enabled: false, allow_org_ids: [], allow_user_ids: [] } })).toHaveLength(1);
    expect(await run({ flag: null })).toHaveLength(1);
  });

  it('falha ao ler flag/caixas: visível (fail-open)', async () => {
    service.createServiceRoleClient.mockImplementation(() => {
      throw new Error('sem service role');
    });
    mockFrom.mockImplementation(() => chain({ data: [], error: null }));
    // reaproveita o cenário padrão, mas com o cliente de serviço quebrado
    const data = await (async () => {
      const lead = { id: 'lead-1', org_id: V4, nome_fantasia: 'ABC', cnpj: '1', assigned_to: 'sdr-1', whatsapp_invalid_at: null, email_bounced_at: null };
      mockFrom.mockImplementation((table: string) => {
        if (table === 'organization_members') return chain({ data: { org_id: V4 }, error: null });
        if (table === 'cadence_enrollments')
          return chain({ data: [{ id: 'e', cadence_id: 'c', lead_id: 'lead-1', current_step: 1, status: 'active', next_step_due: DUE_RECENT, lead, cadence: { id: 'c', name: 'M', total_steps: 1, created_by: 'x', type: 'standard', executor: 'human' } }], error: null });
        if (table === 'cadence_steps')
          return chain({ data: [{ id: 's', cadence_id: 'c', step_order: 1, channel: 'email', template_id: null, delay_days: 0, delay_hours: 0, ai_personalization: false }], error: null });
        return chain({ data: [], error: null });
      });
      const r = await fetchPendingActivities();
      return r.success ? r.data : [];
    })();
    expect(data).toHaveLength(1);
  });

  it('ligação e WhatsApp da cadência mista: inalterados (visíveis)', async () => {
    expect(await run({ channel: 'phone' })).toHaveLength(1);
    expect(await run({ channel: 'whatsapp' })).toHaveLength(1);
  });

  it('bdr_ai e auto_email continuam fora da fila humana, como antes', async () => {
    expect(await run({ cadence: { executor: 'bdr_ai' } })).toHaveLength(0);
    expect(await run({ cadence: { type: 'auto_email', executor: null } })).toHaveLength(0);
  });
});
