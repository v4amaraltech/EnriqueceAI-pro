import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/user-directory', () => ({
  resolveUserEmails: (ids: string[]) => Promise.resolve(new Map(ids.filter((i) => i === 'u-closer').map((i) => [i, 'ana_closer@v4.com']))),
}));

import { assertMeetingRefsInOrg, closerRowIdForUser, getOrCreateMeetingRequest } from './meeting-requests';

let calls: Array<{ table: string; filters: string[] }>;
let results: Record<string, unknown>;

function chain(table: string) {
  const call = { table, filters: [] as string[] };
  calls.push(call);
  const c: Record<string, unknown> = {};
  const pass = (name: string) => (col: string, val?: unknown) => {
    call.filters.push(`${name}:${col}=${JSON.stringify(val)}`);
    return c;
  };
  for (const f of ['eq', 'is', 'in', 'ilike']) c[f] = pass(f);
  c.select = () => c;
  c.limit = () => c;
  c.insert = () => c;
  c.maybeSingle = () => Promise.resolve(results[table] ?? { data: null });
  return c;
}
const supabase = { from: (t: string) => chain(t) } as never;
const ORG = 'org-1';

beforeEach(() => {
  calls = [];
  results = {};
});

describe('assertMeetingRefsInOrg', () => {
  const refs = { orgId: ORG, leadId: 'lead-1', closerId: 'closer-1', conversationId: 'conv-1' };

  it('lead, closer e conversa da org → ok, e cada checagem filtra pela org', async () => {
    results = { leads: { data: { id: 'lead-1' } }, organization_members: { data: { user_id: 'closer-1' } }, email_conversations: { data: { id: 'conv-1' } } };
    await expect(assertMeetingRefsInOrg(supabase, refs)).resolves.toBeUndefined();
    for (const t of ['leads', 'organization_members', 'email_conversations']) {
      expect(calls.find((c) => c.table === t)?.filters).toContain(`eq:org_id="${ORG}"`);
    }
  });

  it.each([
    ['lead de outra org', { organization_members: { data: { user_id: 'c' } }, email_conversations: { data: { id: 'x' } } }, 'lead_invalido'],
    ['closer que não é membro ativo', { leads: { data: { id: 'l' } }, email_conversations: { data: { id: 'x' } } }, 'closer_invalido'],
    ['conversa de outra org/lead', { leads: { data: { id: 'l' } }, organization_members: { data: { user_id: 'c' } } }, 'conversa_invalida'],
  ])('%s → 400', async (_l, r, code) => {
    results = r;
    await expect(assertMeetingRefsInOrg(supabase, refs)).rejects.toMatchObject({ statusCode: 400, code });
  });

  it('sem conversation_id não consulta conversas', async () => {
    results = { leads: { data: { id: 'l' } }, organization_members: { data: { user_id: 'c' } } };
    await assertMeetingRefsInOrg(supabase, { ...refs, conversationId: null });
    expect(calls.some((c) => c.table === 'email_conversations')).toBe(false);
  });
});

describe('getOrCreateMeetingRequest', () => {
  it('busca por execution_id e por lead SEMPRE dentro da org', async () => {
    results = { meeting_requests: { data: { id: 'mr-1', estado: 'aberta' } } };
    await getOrCreateMeetingRequest(supabase, { orgId: ORG, leadId: 'lead-1', closerId: 'c', origem: 'agente', executionId: '123' });
    const byExec = calls.find((c) => c.filters.includes('eq:execution_id="123"'));
    expect(byExec?.filters).toContain(`eq:org_id="${ORG}"`);
  });

  it('solicitação ativa do lead também filtrada pela org', async () => {
    results = { meeting_requests: { data: { id: 'mr-1', estado: 'aberta' } } };
    await getOrCreateMeetingRequest(supabase, { orgId: ORG, leadId: 'lead-1', closerId: 'c', origem: 'agente' });
    const byLead = calls.find((c) => c.filters.includes('eq:lead_id="lead-1"'));
    expect(byLead?.filters).toContain(`eq:org_id="${ORG}"`);
  });
});

describe('closerRowIdForUser (leads.closer_id aponta para closers, não para usuários)', () => {
  it('acha o closer da org pelo e-mail do usuário (curingas escapados)', async () => {
    results = { closers: { data: { id: 'closer-row-1' } } };
    expect(await closerRowIdForUser(supabase, ORG, 'u-closer')).toBe('closer-row-1');
    const q = calls.find((c) => c.table === 'closers');
    expect(q?.filters).toEqual(expect.arrayContaining([`eq:org_id="${ORG}"`, 'ilike:email="ana\\\\_closer@v4.com"']));
  });

  it('usuário sem e-mail ou sem closer correspondente → null (marca a reunião sem closer)', async () => {
    expect(await closerRowIdForUser(supabase, ORG, 'u-sem-email')).toBeNull();
    results = { closers: { data: null } };
    expect(await closerRowIdForUser(supabase, ORG, 'u-closer')).toBeNull();
  });
});
