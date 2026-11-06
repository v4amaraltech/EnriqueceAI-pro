import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUserById: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc, auth: { admin: { getUserById: mocks.getUserById } } }),
}));

import { resolveUserEmails, resolveUserProfiles } from './user-directory';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({
    data: [
      { id: A, email: 'ana.souza@v4.com', full_name: 'Ana Souza', avatar_url: 'https://x/a.png' },
      { id: B, email: 'bruno@v4.com', full_name: null, avatar_url: null },
    ],
    error: null,
  });
});

describe('resolveUserProfiles', () => {
  it('resolve todos os ids numa única chamada ao banco', async () => {
    const map = await resolveUserProfiles([A, B, A]);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('get_user_profiles', { p_user_ids: [A, B] });
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(map.get(A)).toEqual({
      id: A,
      email: 'ana.souza@v4.com',
      fullName: 'Ana Souza',
      avatarUrl: 'https://x/a.png',
      displayName: 'Ana Souza',
    });
  });

  it('sem nome: displayName cai no prefixo do e-mail', async () => {
    const map = await resolveUserProfiles([B]);
    expect(map.get(B)?.displayName).toBe('bruno');
    expect(map.get(B)?.fullName).toBeNull();
  });

  it('id que não existe fica fora do mapa (quem chama mantém o próprio fallback)', async () => {
    const map = await resolveUserProfiles([C]);
    expect(map.has(C)).toBe(false);
  });

  it('ignora vazios e valores que não são uuid, sem ir ao banco', async () => {
    const map = await resolveUserProfiles([null, undefined, '', 'nao-e-uuid']);
    expect(map.size).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('se a função do banco falhar, cai no getUserById um a um', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    mocks.getUserById.mockImplementation((id: string) =>
      Promise.resolve(
        id === A
          ? { data: { user: { id: A, email: 'ana.souza@v4.com', user_metadata: { name: '  Ana  ' } } }, error: null }
          : { data: { user: null }, error: { message: 'not found' } },
      ),
    );

    const map = await resolveUserProfiles([A, C]);

    expect(mocks.getUserById).toHaveBeenCalledTimes(2);
    expect(map.get(A)?.displayName).toBe('Ana');
    expect(map.has(C)).toBe(false);
  });
});

describe('resolveUserEmails', () => {
  it('devolve só quem tem e-mail', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { id: A, email: 'ana.souza@v4.com', full_name: 'Ana', avatar_url: null },
        { id: B, email: null, full_name: 'Sem Email', avatar_url: null },
      ],
      error: null,
    });
    const map = await resolveUserEmails([A, B]);
    expect([...map]).toEqual([[A, 'ana.souza@v4.com']]);
  });
});

describe('resolveUserProfiles — falhas', () => {
  it('RPC lançando exceção também cai no getUserById (com avatar picture)', async () => {
    mocks.rpc.mockRejectedValue(new Error('network'));
    mocks.getUserById.mockResolvedValue({
      data: { user: { id: A, email: 'ana@v4.com', user_metadata: { picture: 'https://x/p.png' } } },
      error: null,
    });
    const map = await resolveUserProfiles([A]);
    expect(map.get(A)?.avatarUrl).toBe('https://x/p.png');
    expect(map.get(A)?.displayName).toBe('ana');
  });
});
