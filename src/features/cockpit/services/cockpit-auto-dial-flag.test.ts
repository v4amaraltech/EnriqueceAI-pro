import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const ORG = 'org-1';
const USER = 'user-1';
const scope = { orgId: ORG, userId: USER };

function flags(rows: Row[], fail = false) {
  const db: AutoDialDb = { tables: { app_flags: rows }, failReads: new Set(fail ? ['app_flags'] : []), reads: [], writes: [], rpc: vi.fn() };
  vi.mocked(createServiceRoleClient).mockReturnValue(makeAutoDialClient(db) as never);
}
const row = (key: string, over: Row = {}): Row => ({ key, enabled: false, allow_org_ids: [ORG], allow_user_ids: [USER], ...over });

beforeEach(() => vi.clearAllMocks());

// O fake devolve todas as linhas; cada teste usa só as chaves de que precisa e filtra por chave abaixo.
function flagsByKey(rows: Row[]) {
  const db: AutoDialDb = { tables: { app_flags: rows }, failReads: new Set(), reads: [], writes: [], rpc: vi.fn() };
  const base = makeAutoDialClient(db);
  const client = {
    ...base,
    from: (t: string) => {
      const b = base.from(t) as Record<string, unknown>;
      let key: unknown;
      const origEq = b.eq as (c: string, v: unknown) => unknown;
      b.eq = (c: string, v: unknown) => {
        if (c === 'key') key = v;
        return origEq(c, v);
      };
      const origThen = b.then as (ok: (v: { data: Row[] }) => unknown, ko: (e: unknown) => unknown) => Promise<unknown>;
      b.then = (ok: (v: { data: Row[] }) => unknown, ko: (e: unknown) => unknown) =>
        origThen((r) => ok({ ...r, data: (r.data ?? []).filter((x) => x.key === key) }), ko);
      return b;
    },
  };
  vi.mocked(createServiceRoleClient).mockReturnValue(client as never);
}

describe('flags do motor (CON-6)', () => {
  it('linhas ausentes (migration não aplicada) = desligado', async () => {
    flagsByKey([]);
    expect(await isCockpitAutoDialEnabled(scope)).toBe(false);
    expect(await isCockpitAutoDialLive(scope)).toBe(false);
  });

  it('o motor exige call_cockpit_outcomes E cockpit_auto_dial', async () => {
    flagsByKey([row('cockpit_auto_dial')]);
    expect(await isCockpitAutoDialEnabled(scope)).toBe(false);
    flagsByKey([row('call_cockpit_outcomes')]);
    expect(await isCockpitAutoDialEnabled(scope)).toBe(false);
    flagsByKey([row('call_cockpit_outcomes'), row('cockpit_auto_dial')]);
    expect(await isCockpitAutoDialEnabled(scope)).toBe(true);
  });

  it('ligação real exige as 3 flags', async () => {
    flagsByKey([row('call_cockpit_outcomes'), row('cockpit_auto_dial')]);
    expect(await isCockpitAutoDialLive(scope)).toBe(false);
    flagsByKey([row('cockpit_auto_dial'), row('cockpit_auto_dial_live')]);
    expect(await isCockpitAutoDialLive(scope)).toBe(false);
    flagsByKey([row('call_cockpit_outcomes'), row('cockpit_auto_dial_live')]);
    expect(await isCockpitAutoDialLive(scope)).toBe(false);
    flagsByKey([row('call_cockpit_outcomes'), row('cockpit_auto_dial'), row('cockpit_auto_dial_live')]);
    expect(await isCockpitAutoDialLive(scope)).toBe(true);
  });

  it('escopo: outra org ou outro usuário não liga', async () => {
    flagsByKey([row('call_cockpit_outcomes'), row('cockpit_auto_dial')]);
    expect(await isCockpitAutoDialEnabled({ orgId: 'org-2', userId: USER })).toBe(false);
    expect(await isCockpitAutoDialEnabled({ orgId: ORG, userId: 'outro' })).toBe(false);
  });

  it('flag desligada com listas vazias (estado da migration) = desligado', async () => {
    flagsByKey([row('call_cockpit_outcomes', { allow_org_ids: [], allow_user_ids: [] }), row('cockpit_auto_dial', { allow_org_ids: [], allow_user_ids: [] })]);
    expect(await isCockpitAutoDialEnabled(scope)).toBe(false);
  });

  it('erro de leitura = desligado (falha fechada)', async () => {
    flags([], true);
    expect(await isCockpitAutoDialEnabled(scope)).toBe(false);
    expect(await isCockpitAutoDialLive(scope)).toBe(false);
  });
});
