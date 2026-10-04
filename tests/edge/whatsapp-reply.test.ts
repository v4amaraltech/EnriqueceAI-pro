import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: unknown;
  filters: string[];
  order?: string;
}

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  results: {} as Record<string, unknown>,
}));

vi.mock('../../supabase/functions/_shared/supabase-admin.ts', () => {
  const chain = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    state.calls.push(call);
    const result = () => {
      const r = state.results[`${table}:${call.op}`];
      return typeof r === 'function' ? (r as (c: Call) => unknown)(call) : (r ?? { data: null, error: null });
    };
    const c: Record<string, unknown> = {};
    const pass = (name: string) => (col: string, val?: unknown) => {
      call.filters.push(`${name}:${col}=${JSON.stringify(val)}`);
      return c;
    };
    c.select = () => c;
    for (const f of ['eq', 'in', 'is', 'neq']) c[f] = pass(f);
    c.order = (col: string) => {
      call.order = col;
      return c;
    };
    c.limit = () => c;
    c.insert = (payload: unknown) => {
      call.op = 'insert';
      call.payload = payload;
      return c;
    };
    c.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return c;
    };
    c.maybeSingle = () => Promise.resolve(result());
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return c;
  };
  return { supabaseAdmin: { from: chain } };
});

import { captureInboundReply } from '../../supabase/functions/_shared/whatsapp-reply';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const reply = { phone: '5511999998888', text: 'tenho interesse', messageId: 'MSG-1', pushName: 'Ana' };
const LEAD = { id: 'lead-1', org_id: ORG, nome_fantasia: 'ACME', razao_social: null, assigned_to: 'sdr-1' };

const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  state.calls = [];
  state.results = {
    'app_flags:select': ok({ enabled: true }),
    'leads:select': ok(LEAD),
    'interactions:select': ok([]),
    'cadence_enrollments:select': ok({ id: 'enr-1', cadence_id: 'cad-1', current_step: 2, enrolled_by: 'mgr' }),
    'cadence_steps:select': ok({ id: 'step-2' }),
    'interactions:insert': ok(null),
    'cadence_enrollments:update': ok(null),
    'notifications:insert': ok(null),
  };
});

const find = (table: string, op: Call['op']) => state.calls.find((c) => c.table === table && c.op === op);

describe('captureInboundReply', () => {
  it('chave desligada (ou sem linha): não faz nada', async () => {
    state.results['app_flags:select'] = ok(null);
    expect(await captureInboundReply(ORG, reply)).toEqual({ status: 'disabled' });
    expect(state.calls.map((c) => c.table)).toEqual(['app_flags']);
  });

  it('registra a resposta, para as cadências e avisa o SDR', async () => {
    expect(await captureInboundReply(ORG, reply)).toEqual({ status: 'recorded', leadId: 'lead-1' });

    expect(find('leads', 'select')?.filters).toContain(`eq:org_id=${JSON.stringify(ORG)}`);
    expect(find('interactions', 'insert')?.payload).toMatchObject({
      lead_id: 'lead-1',
      cadence_id: 'cad-1',
      step_id: 'step-2',
      type: 'replied',
      external_id: 'MSG-1',
    });
    expect(find('cadence_enrollments', 'update')?.payload).toMatchObject({ status: 'replied' });
    expect(find('notifications', 'insert')?.payload).toMatchObject({ user_id: 'sdr-1', type: 'whatsapp_reply' });
  });

  it('ordena a inscrição por enrolled_at (cadence_enrollments não tem created_at)', async () => {
    await captureInboundReply(ORG, reply);
    expect(find('cadence_enrollments', 'select')?.order).toBe('enrolled_at');
  });

  it('erro na busca da inscrição sobe (não vira "sem inscrição")', async () => {
    state.results['cadence_enrollments:select'] = { data: null, error: { message: 'column created_at does not exist' } };
    await expect(captureInboundReply(ORG, reply)).rejects.toThrow(/enrollment lookup failed/);
  });

  it('erro na busca do lead sobe (não vira "lead não encontrado")', async () => {
    state.results['leads:select'] = { data: null, error: { message: 'invalid input syntax for type uuid: "undefined"' } };
    await expect(captureInboundReply(ORG, reply)).rejects.toThrow(/lead lookup failed/);
  });

  it('mensagem já registrada (reenvio do webhook) não grava de novo', async () => {
    state.results['interactions:select'] = ok([{ id: 'ix-1' }]);
    expect(await captureInboundReply(ORG, reply)).toEqual({ status: 'duplicate' });
    expect(find('interactions', 'insert')).toBeUndefined();
    expect(find('interactions', 'select')?.filters).toContain('eq:lead_id="lead-1"');
  });

  it('lead sem inscrição ativa: só retorna, sem mexer em nada', async () => {
    state.results['cadence_enrollments:select'] = ok(null);
    expect(await captureInboundReply(ORG, reply)).toEqual({ status: 'no_enrollment' });
    expect(find('interactions', 'insert')).toBeUndefined();
  });

  it('falha ao gravar a resposta sobe como erro (webhook devolve 5xx)', async () => {
    state.results['interactions:insert'] = { data: null, error: { message: 'boom' } };
    await expect(captureInboundReply(ORG, reply)).rejects.toThrow(/replied interaction insert failed/);
    expect(find('cadence_enrollments', 'update')).toBeUndefined();
  });
});
