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
  const rpc = (fn: string, args: Record<string, unknown>) => {
    state.calls.push({ table: `rpc:${fn}`, op: 'select', payload: args, filters: [] });
    const r = state.results[`rpc:${fn}`];
    return Promise.resolve(typeof r === 'function' ? (r as (a: unknown) => unknown)(args) : (r ?? { data: [], error: null }));
  };
  return { supabaseAdmin: { from: chain, rpc } };
});

import { captureInboundReply } from '../../supabase/functions/_shared/whatsapp-reply';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const reply = { phone: '5511999998888', text: 'tenho interesse', messageId: 'MSG-1', pushName: 'Ana' };
const LEAD = { id: 'lead-1', org_id: ORG, nome_fantasia: 'ACME', razao_social: null, assigned_to: 'sdr-1' };

const ok = (data: unknown) => ({ data, error: null });

/** Telefones dos leads candidatos (como estão salvos). */
let PHONES: Array<{ id: string; telefone: string | null; phones: unknown }>;

beforeEach(() => {
  state.calls = [];
  PHONES = [
    { id: 'lead-1', telefone: '(11) 99999-8888', phones: [] },
    { id: 'lead-velho', telefone: '1199998888', phones: null },
    { id: 'lead-sem-cadencia', telefone: null, phones: [{ tipo: 'celular', numero: '5511999998888' }] },
    { id: 'lead-outro-ddd', telefone: '(51) 99999-8888', phones: [] },
  ];
  state.results = {
    'app_flags:select': ok({ enabled: true }),
    'rpc:find_lead_ids_by_phone': ok(['lead-1']),
    // 1ª consulta (in:id) = candidatos com telefones p/ conferência exata; 2ª (eq:id) = o lead escolhido.
    'leads:select': (c: Call) =>
      c.filters.some((f) => f.startsWith('in:id='))
        ? ok(PHONES.filter((p) => (JSON.parse(c.filters.find((f) => f.startsWith('in:id='))!.slice(6)) as string[]).includes(p.id)))
        : ok(LEAD),
    'interactions:select': ok([]),
    'cadence_enrollments:select': ok({ id: 'enr-1', lead_id: 'lead-1', cadence_id: 'cad-1', current_step: 2, enrolled_by: 'mgr' }),
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

    const chosen = state.calls.find((c) => c.table === 'leads' && c.filters.includes('eq:id="lead-1"'));
    expect(chosen?.filters).toContain(`eq:org_id=${JSON.stringify(ORG)}`);
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
    state.results['rpc:find_lead_ids_by_phone'] = { data: null, error: { message: 'invalid input syntax for type uuid: "undefined"' } };
    await expect(captureInboundReply(ORG, reply)).rejects.toThrow(/lead lookup failed/);
  });

  it('busca por dígitos nas duas formas do número (com e sem o 9) e junta os leads', async () => {
    const seen: string[] = [];
    state.results['rpc:find_lead_ids_by_phone'] = (args: { p_org_id: string; p_phone_digits: string }) => {
      seen.push(args.p_phone_digits);
      expect(args.p_org_id).toBe(ORG);
      return ok(args.p_phone_digits === '11999998888' ? ['lead-1'] : ['lead-velho']);
    };

    await captureInboundReply(ORG, { ...reply, phone: '5511999998888' });

    expect(seen).toEqual(['11999998888', '1199998888']);
    const enr = find('cadence_enrollments', 'select');
    expect(enr?.filters).toContain('in:lead_id=["lead-1","lead-velho"]');
  });

  it('nenhum lead com esse número → no_lead, sem consultar mais nada', async () => {
    state.results['rpc:find_lead_ids_by_phone'] = ok([]);
    expect(await captureInboundReply(ORG, reply)).toEqual({ status: 'no_lead' });
    expect(find('cadence_enrollments', 'select')).toBeUndefined();
  });

  it('número de dois leads: procura a inscrição ativa entre os dois e fica com a que vier', async () => {
    state.results['rpc:find_lead_ids_by_phone'] = ok(['lead-sem-cadencia', 'lead-1']);
    // O banco devolve só a inscrição ativa existente (do lead-1).
    state.results['cadence_enrollments:select'] = (c: Call) => {
      const inFilter = c.filters.find((f) => f.startsWith('in:lead_id='))!;
      expect((JSON.parse(inFilter.slice('in:lead_id='.length)) as string[]).sort()).toEqual(['lead-1', 'lead-sem-cadencia']);
      expect(c.filters).toContain('eq:status="active"');
      return ok({ id: 'enr-1', lead_id: 'lead-1', cadence_id: 'cad-1', current_step: 2, enrolled_by: 'mgr' });
    };
    const res = await captureInboundReply(ORG, reply);
    expect(res).toEqual({ status: 'recorded', leadId: 'lead-1' });
    expect(find('interactions', 'insert')?.payload).toMatchObject({ lead_id: 'lead-1' });
  });

  it('lead de OUTRO DDD que a RPC devolveu pelos 10 últimos dígitos é descartado', async () => {
    // (51) 99999-8888 tem os mesmos 10 últimos dígitos de 11 99999-8888 sem o 1º do DDD.
    state.results['rpc:find_lead_ids_by_phone'] = ok(['lead-outro-ddd']);
    expect(await captureInboundReply(ORG, { ...reply, phone: '5511999998888' })).toEqual({ status: 'no_lead' });
    expect(find('cadence_enrollments', 'select')).toBeUndefined();
  });

  it('número em phones[] (lista de contatos do lead) também conta', async () => {
    state.results['rpc:find_lead_ids_by_phone'] = ok(['lead-sem-cadencia']);
    state.results['cadence_enrollments:select'] = ok({ id: 'e', lead_id: 'lead-sem-cadencia', cadence_id: 'c', current_step: 1, enrolled_by: null });
    state.results['leads:select'] = (c: Call) =>
      c.filters.some((f) => f.startsWith('in:id=')) ? ok([PHONES[2]]) : ok({ ...LEAD, id: 'lead-sem-cadencia' });
    expect(await captureInboundReply(ORG, reply)).toEqual({ status: 'recorded', leadId: 'lead-sem-cadencia' });
  });

  it.each([
    ['número estrangeiro', '351912345678'],
    ['id interno @lid do WhatsApp', '123456789012345'],
  ])('%s não vai ao banco (evita casar lead aleatório pelos últimos dígitos)', async (_l, phone) => {
    expect(await captureInboundReply(ORG, { ...reply, phone })).toEqual({ status: 'no_lead' });
    expect(state.calls.some((c) => c.table === 'rpc:find_lead_ids_by_phone')).toBe(false);
  });

  it('mensagem já registrada (reenvio do webhook) não grava de novo', async () => {
    state.results['interactions:select'] = ok([{ id: 'ix-1' }]);
    expect(await captureInboundReply(ORG, reply)).toEqual({ status: 'duplicate' });
    expect(find('interactions', 'insert')).toBeUndefined();
    expect(find('interactions', 'select')?.filters).toContain('in:lead_id=["lead-1"]');
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
