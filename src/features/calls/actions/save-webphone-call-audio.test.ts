import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);

import { saveWebphoneCallAudio } from './save-webphone-call-audio';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000001';
const stats = { packetsReceived: 100, packetsLost: 2, lossPercent: 2, jitterMs: 12.3, rttMs: 46, collectedAt: '2026-10-21T19:00:00.000Z' };

/** Supabase falso: `select…maybeSingle` devolve `row`; `update` registra o payload. */
function supabaseWith(row: Record<string, unknown> | null, updateError: { message: string } | null = null) {
  const updates: Array<{ payload: Record<string, unknown>; filters: Array<[string, string]> }> = [];
  const client = {
    from: () => {
      const filters: Array<[string, string]> = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: string) => {
          filters.push([col, val]);
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
        update: (payload: Record<string, unknown>) => {
          const entry = { payload, filters };
          updates.push(entry);
          const upd: Record<string, unknown> = {
            eq: (col: string, val: string) => {
              filters.push([col, val]);
              return upd;
            },
            then: (resolve: (v: unknown) => void) => resolve({ error: updateError }),
          };
          return upd;
        },
      };
      return chain;
    },
  };
  return { client, updates };
}

describe('saveWebphoneCallAudio', () => {
  beforeEach(() => {
    auth.getAuthOrgIdResult.mockReset();
  });

  function authAs(userId: string, supabase: unknown) {
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org-1', userId, role: 'sdr', supabase } });
  }

  it('recusa dados inválidos antes de tocar no banco', async () => {
    expect(await saveWebphoneCallAudio({ callId: CALL_ID })).toEqual({ success: false, error: 'Dados inválidos' });
    expect(await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 9 })).toEqual({ success: false, error: 'Dados inválidos' });
    expect(auth.getAuthOrgIdResult).not.toHaveBeenCalled();
  });

  it('grava a avaliação mesclando no metadata, filtrando por id e org', async () => {
    const { client, updates } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: { api4com_call_id: 'abc' } });
    authAs('u1', client);
    const r = await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 4 });
    expect(r).toEqual({ success: true, data: { callId: CALL_ID } });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload.metadata).toEqual({ api4com_call_id: 'abc', audio_quality: 4 });
    expect(updates[0]?.payload.updated_at).toEqual(expect.any(String));
    expect(updates[0]?.filters).toEqual(expect.arrayContaining([['id', CALL_ID], ['org_id', 'org-1']]));
  });

  it('grava as estatísticas de áudio', async () => {
    const { client, updates } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: null });
    authAs('u1', client);
    await saveWebphoneCallAudio({ callId: CALL_ID, audioStats: stats });
    expect(updates[0]?.payload.metadata).toEqual({ audio_stats: stats });
  });

  it('ligação de outro usuário não pode ser avaliada', async () => {
    const { client, updates } = supabaseWith({ id: CALL_ID, user_id: 'outro', metadata: {} });
    authAs('u1', client);
    const r = await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 5 });
    expect(r).toEqual({ success: false, error: 'Só quem fez a ligação pode avaliar o áudio' });
    expect(updates).toHaveLength(0);
  });

  it('ligação inexistente (ou de outra org, filtrada pelo select)', async () => {
    const { client } = supabaseWith(null);
    authAs('u1', client);
    expect(await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 5 })).toEqual({ success: false, error: 'Ligação não encontrada' });
  });

  it('erro do banco ao gravar vira erro amigável', async () => {
    const { client } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: {} }, { message: 'boom' });
    authAs('u1', client);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 5 })).toEqual({ success: false, error: 'Erro ao gravar a avaliação' });
    spy.mockRestore();
  });

  it('sem sessão devolve o erro do auth', async () => {
    auth.getAuthOrgIdResult.mockResolvedValue({ success: false, error: 'Organização não encontrada' });
    expect(await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 5 })).toEqual({ success: false, error: 'Organização não encontrada' });
  });
});
