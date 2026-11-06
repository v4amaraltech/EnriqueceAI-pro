import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

import {
  clearKommoUsersCache,
  fetchKommoUsersCached,
  resolveKommoResponsibleUserId,
  type KommoUserLite,
} from './crm-responsible';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const LEAD = '74fdbd11-63fc-42c6-bf74-a225ef695610';
const CLOSER = 'closer-jhonata';
const CREDS = { access_token: 't', refresh_token: 'r', subdomain: 'v4amaral' };

const KOMMO_USERS: KommoUserLite[] = [
  { id: 11111111, name: 'Vini', email: 'vinicius.mercante@v4company.com' },
  { id: 15013532, name: 'Jhonata Banqueri', email: 'Jhonata.Banqueri@V4company.com' },
];

/** Tabela `closers`: devolve o e-mail do closer (ou null = não encontrado). */
function installClosers(email: string | null) {
  const tables: string[] = [];
  mockFrom.mockImplementation((table: string) => {
    tables.push(table);
    const b = createQueryBuilder();
    if (table === 'closers') {
      b.maybeSingle = vi.fn(() => Promise.resolve({ data: email === null ? null : { email }, error: null }));
    }
    return b;
  });
  return tables;
}

function makeAdapter(users: KommoUserLite[] = KOMMO_USERS) {
  return { fetchUsers: vi.fn(() => Promise.resolve(users)) };
}

function resolve(overrides: Partial<Parameters<typeof resolveKommoResponsibleUserId>[0]> = {}) {
  return resolveKommoResponsibleUserId({
    supabase: mockSupabase as never,
    orgId: ORG,
    leadId: LEAD,
    closerId: CLOSER,
    explicitUserId: undefined,
    connectionDefaultUserId: undefined,
    adapter: makeAdapter(),
    credentials: CREDS,
    ...overrides,
  });
}

describe('resolveKommoResponsibleUserId', () => {
  beforeEach(() => {
    resetMocks();
    clearKommoUsersCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('resolve pelo e-mail do closer (sem diferenciar maiúsculas/espaços)', async () => {
    installClosers('  jhonata.banqueri@v4company.com ');

    await expect(resolve()).resolves.toBe('15013532');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('cai no padrão da conexão quando o e-mail do closer não casa com nenhum usuário', async () => {
    installClosers('ninguem@outra.com');

    await expect(resolve({ connectionDefaultUserId: '99' })).resolves.toBe('99');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('closer sem usuário no Kommo'), LEAD, ORG, CLOSER, 'ninguem@outra.com');
  });

  it('respeita o responsável explícito do modal sem consultar closer nem usuários', async () => {
    const tables = installClosers('jhonata.banqueri@v4company.com');
    const adapter = makeAdapter();

    await expect(resolve({ explicitUserId: '42', adapter })).resolves.toBe('42');
    expect(tables).not.toContain('closers');
    expect(adapter.fetchUsers).not.toHaveBeenCalled();
  });

  it('explícito igual ao padrão da conexão não vence o closer (chamadores sem modal repassam o padrão)', async () => {
    installClosers('jhonata.banqueri@v4company.com');

    await expect(resolve({ explicitUserId: '99', connectionDefaultUserId: '99' })).resolves.toBe('15013532');
  });

  it('sem closer não consulta usuários do Kommo e usa o padrão da conexão', async () => {
    const tables = installClosers(null);
    const adapter = makeAdapter();

    await expect(resolve({ closerId: null, connectionDefaultUserId: '99', adapter })).resolves.toBe('99');
    expect(tables).not.toContain('closers');
    expect(adapter.fetchUsers).not.toHaveBeenCalled();
  });

  it('sem closer casado e sem padrão segue sem responsável, avisando com o leadId', async () => {
    installClosers(null);

    await expect(resolve({ closerId: null })).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('sem responsável'), LEAD, ORG);
  });

  it('erro ao buscar usuários do Kommo não derruba o push: cai no padrão', async () => {
    installClosers('jhonata.banqueri@v4company.com');
    const adapter = { fetchUsers: vi.fn(() => Promise.reject(new Error('fetch failed'))) };

    await expect(resolve({ adapter, connectionDefaultUserId: '99' })).resolves.toBe('99');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('falha ao resolver'), LEAD, ORG, expect.any(Error));
  });
});

describe('fetchKommoUsersCached', () => {
  beforeEach(() => clearKommoUsersCache());

  it('reaproveita a lista por org dentro do prazo e busca de novo depois', async () => {
    const adapter = makeAdapter();

    await fetchKommoUsersCached(ORG, adapter, CREDS, 1_000);
    await fetchKommoUsersCached(ORG, adapter, CREDS, 2_000);
    expect(adapter.fetchUsers).toHaveBeenCalledTimes(1);

    await fetchKommoUsersCached('outra-org', adapter, CREDS, 2_000);
    expect(adapter.fetchUsers).toHaveBeenCalledTimes(2);

    await fetchKommoUsersCached(ORG, adapter, CREDS, 1_000 + 5 * 60 * 1000 + 1);
    expect(adapter.fetchUsers).toHaveBeenCalledTimes(3);
  });
});
