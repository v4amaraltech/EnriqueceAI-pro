import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { type AutoDialDb, type Row, makeAutoDialClient } from '../services/auto-dial.testkit';
import { getAutoDialDayStatsAction } from './auto-dial-stats';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const ORG = 'org-1';
const ME = 'user-1';
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const call = (over: Row = {}): Row => ({
  id: `c${Math.random()}`,
  org_id: ORG,
  user_id: ME,
  lead_id: 'L',
  created_at: ago(60),
  started_at: ago(60),
  answered_at: ago(59),
  duration_seconds: 120,
  status: 'completed',
  sdr_disposition: 'relevant_conversation',
  metadata: { cockpit_auto_dial: {} },
  ...over,
});

let db: AutoDialDb;
function setup(calls: Row[], role = 'sdr') {
  db = { tables: { calls }, failReads: new Set(), reads: [], writes: [], rpc: undefined as never };
  const client = makeAutoDialClient(db) as never;
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({
    success: true,
    data: { orgId: ORG, userId: ME, role, supabase: client },
  } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

describe('getAutoDialDayStatsAction', () => {
  it('devolve o resumo do usuário autenticado (gestor também; nunca de outro usuário)', async () => {
    setup(
      [
        call(),
        call({
          sdr_disposition: 'no_answer',
          answered_at: null,
          duration_seconds: 0,
          status: 'not_connected',
        }),
        call({ user_id: 'outro' }),
      ],
      'manager',
    );
    expect(await getAutoDialDayStatsAction()).toEqual({
      success: true,
      data: { callsToday: 2, answeredToday: 1, ratePct: 50, dailyCap: 400, remaining: 398 },
    });
    expect(db.writes).toEqual([]);
  });

  it('o navegador não escolhe o alvo: parâmetros extras são recusados', async () => {
    setup([call()]);
    expect(await getAutoDialDayStatsAction({ userId: 'outro' })).toEqual({
      success: false,
      error: 'Dados inválidos',
    });
    expect(db.reads).toEqual([]);
  });

  it('sem sessão: devolve o erro de autenticação e não lê nada', async () => {
    setup([]);
    vi.mocked(getAuthOrgIdResult).mockResolvedValue({
      success: false,
      error: 'Não autenticado',
    } as never);
    expect(await getAutoDialDayStatsAction()).toEqual({ success: false, error: 'Não autenticado' });
    expect(db.reads).toEqual([]);
  });

  it('erro de leitura vira erro (sem número parcial)', async () => {
    setup([call()]);
    db.failReads.add('calls');
    expect(await getAutoDialDayStatsAction()).toEqual({
      success: false,
      error: 'Falha ao ler o resumo do dia',
    });
  });
});
