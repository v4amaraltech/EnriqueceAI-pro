import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateFlagRow,
  flagRowHasAnyScope,
  isFlagEnabledForAnyScope,
  isScopedFlagEnabled,
  readScopedFlagState,
} from './flag-scope.service';

const mocks = vi.hoisted(() => ({ rows: vi.fn(), calls: [] as string[] }));

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({}) }));
vi.mock('@/lib/supabase/from', () => ({
  from: () => ({
    select: (cols: string) => ({
      eq: () => ({ limit: async () => mocks.rows(cols) }),
      in: async () => mocks.rows(cols),
    }),
  }),
}));

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const SDR = '33333333-3333-4333-8333-333333333333';
const CLOSER = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';

describe('evaluateFlagRow (decisão pura)', () => {
  it('desligada + listas vazias = desligada para qualquer escopo (igual a hoje)', () => {
    const row = { enabled: false, allow_org_ids: [], allow_user_ids: [] };
    expect(evaluateFlagRow(row)).toBe(false);
    expect(evaluateFlagRow(row, { orgId: ORG_A })).toBe(false);
    expect(evaluateFlagRow(row, { orgId: ORG_A, userId: SDR })).toBe(false);
  });

  it('colunas ausentes ou nulas contam como listas vazias', () => {
    expect(evaluateFlagRow({ enabled: false }, { orgId: ORG_A })).toBe(false);
    expect(
      evaluateFlagRow(
        { enabled: false, allow_org_ids: null, allow_user_ids: null },
        { orgId: ORG_A },
      ),
    ).toBe(false);
  });

  it('linha ausente = desligada', () => {
    expect(evaluateFlagRow(null, { orgId: ORG_A })).toBe(false);
    expect(evaluateFlagRow(undefined)).toBe(false);
  });

  it('global ligada vale para todos, com ou sem escopo', () => {
    const row = { enabled: true, allow_org_ids: [], allow_user_ids: [] };
    expect(evaluateFlagRow(row)).toBe(true);
    expect(evaluateFlagRow(row, { orgId: ORG_B })).toBe(true);
  });

  it('corte por organização: liga só a org listada e isola as demais', () => {
    const row = { enabled: false, allow_org_ids: [ORG_A], allow_user_ids: [] };
    expect(evaluateFlagRow(row, { orgId: ORG_A })).toBe(true);
    expect(evaluateFlagRow(row, { orgId: ORG_B })).toBe(false);
  });

  it('sem escopo a lista não vale: leitura global continua desligada', () => {
    expect(evaluateFlagRow({ enabled: false, allow_org_ids: [ORG_A] })).toBe(false);
    expect(evaluateFlagRow({ enabled: false, allow_org_ids: [ORG_A] }, { orgId: null })).toBe(
      false,
    );
  });

  it('comparação ignora caixa', () => {
    expect(
      evaluateFlagRow({ enabled: false, allow_org_ids: [ORG_A.toUpperCase()] }, { orgId: ORG_A }),
    ).toBe(true);
  });

  it('piloto por usuário: só os listados, dentro da org liberada', () => {
    const row = { enabled: false, allow_org_ids: [ORG_A], allow_user_ids: [SDR, CLOSER] };
    expect(evaluateFlagRow(row, { orgId: ORG_A, userId: SDR })).toBe(true);
    expect(evaluateFlagRow(row, { orgId: ORG_A, userId: CLOSER })).toBe(true);
    expect(evaluateFlagRow(row, { orgId: ORG_A, userId: OTHER })).toBe(false);
  });

  it('caminho sem usuário segue o corte da organização', () => {
    const row = { enabled: false, allow_org_ids: [ORG_A], allow_user_ids: [SDR] };
    expect(evaluateFlagRow(row, { orgId: ORG_A })).toBe(true);
    expect(evaluateFlagRow(row, { orgId: ORG_A, userId: null })).toBe(true);
  });

  it('usuário listado em organização fora da lista nunca liga', () => {
    const row = { enabled: false, allow_org_ids: [ORG_A], allow_user_ids: [SDR] };
    expect(evaluateFlagRow(row, { orgId: ORG_B, userId: SDR })).toBe(false);
    expect(
      evaluateFlagRow(
        { enabled: false, allow_org_ids: [], allow_user_ids: [SDR] },
        { orgId: ORG_A, userId: SDR },
      ),
    ).toBe(false);
  });

  it('flagRowHasAnyScope: global, lista de org ou nada', () => {
    expect(flagRowHasAnyScope({ enabled: true })).toBe(true);
    expect(flagRowHasAnyScope({ enabled: false, allow_org_ids: [ORG_A] })).toBe(true);
    expect(flagRowHasAnyScope({ enabled: false, allow_org_ids: [], allow_user_ids: [SDR] })).toBe(
      false,
    );
    expect(flagRowHasAnyScope(null)).toBe(false);
  });
});

describe('leitura com o banco', () => {
  beforeEach(() => {
    mocks.rows.mockReset();
  });

  it('sem escopo lê só `enabled` (mesma consulta de antes)', async () => {
    mocks.rows.mockImplementation(async () => ({ data: [{ enabled: true }], error: null }));
    expect(await isScopedFlagEnabled('x')).toBe(true);
    expect(mocks.rows).toHaveBeenCalledTimes(1);
    expect(mocks.rows).toHaveBeenCalledWith('enabled');
  });

  it('sem escopo, org listada não liga: igual a hoje', async () => {
    mocks.rows.mockImplementation(async () => ({
      data: [{ enabled: false, allow_org_ids: [ORG_A] }],
      error: null,
    }));
    expect(await isScopedFlagEnabled('x')).toBe(false);
  });

  it('isolamento entre organizações na leitura', async () => {
    mocks.rows.mockImplementation(async () => ({
      data: [{ enabled: false, allow_org_ids: [ORG_A], allow_user_ids: [] }],
      error: null,
    }));
    expect(await isScopedFlagEnabled('x', { orgId: ORG_A })).toBe(true);
    expect(await isScopedFlagEnabled('x', { orgId: ORG_B })).toBe(false);
  });

  it('colunas de escopo inexistentes: cai para a leitura global (comportamento atual)', async () => {
    mocks.rows.mockImplementation(async (cols: string) =>
      cols === 'enabled'
        ? { data: [{ enabled: true }], error: null }
        : { data: null, error: { message: 'column allow_org_ids does not exist' } },
    );
    expect(await readScopedFlagState('x', { orgId: ORG_A })).toBe('on');
    mocks.rows.mockImplementation(async (cols: string) =>
      cols === 'enabled'
        ? { data: [{ enabled: false }], error: null }
        : { data: null, error: { message: 'column allow_org_ids does not exist' } },
    );
    expect(await readScopedFlagState('x', { orgId: ORG_A })).toBe('off');
  });

  it('linha ausente = off; erro nas duas leituras = error (flags de restrição falham fechadas)', async () => {
    mocks.rows.mockResolvedValue({ data: [], error: null });
    expect(await readScopedFlagState('x', { orgId: ORG_A })).toBe('off');
    mocks.rows.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await readScopedFlagState('x', { orgId: ORG_A })).toBe('error');
    expect(await isScopedFlagEnabled('x', { orgId: ORG_A })).toBe(false);
  });

  it('exceção vira error', async () => {
    mocks.rows.mockRejectedValue(new Error('boom'));
    expect(await readScopedFlagState('x')).toBe('error');
  });

  it('portão de ciclo: global ou alguma lista', async () => {
    mocks.rows.mockResolvedValue({
      data: [{ enabled: false, allow_org_ids: [ORG_A] }],
      error: null,
    });
    expect(await isFlagEnabledForAnyScope('x')).toBe(true);
    mocks.rows.mockResolvedValue({ data: [{ enabled: false, allow_org_ids: [] }], error: null });
    expect(await isFlagEnabledForAnyScope('x')).toBe(false);
    mocks.rows.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await isFlagEnabledForAnyScope('x')).toBe(false);
  });
});
