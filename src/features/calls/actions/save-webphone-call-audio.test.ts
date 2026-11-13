import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);

import { applyMergeCallsMetadataRpc, type MergeCallsMetadataArgs } from '@tests/mocks/merge-calls-metadata';

import { saveWebphoneCallAudio } from './save-webphone-call-audio';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000001';
const stats = { packetsReceived: 100, packetsLost: 2, lossPercent: 2, jitterMs: 12.3, rttMs: 46, collectedAt: '2026-10-21T19:00:00.000Z' };

/**
 * Supabase falso: `select…maybeSingle` devolve `row` (cópia); a RPC
 * merge_calls_metadata é aplicada de verdade na linha (metadata || patch).
 * `beforeRpc` simula outro escritor gravando entre a leitura e o merge.
 */
function supabaseWith(
  row: Record<string, unknown> | null,
  rpcError: { message: string } | null = null,
  beforeRpc?: (row: Record<string, unknown>) => void,
) {
  const rows: Array<Record<string, unknown>> = row ? [{ org_id: 'org-1', ...row }] : [];
  const rpcCalls: Array<{ fn: string; args: MergeCallsMetadataArgs }> = [];
  const updates: unknown[] = [];
  const client = {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row ? { ...row } : null, error: null }),
        update: (payload: unknown) => {
          updates.push(payload);
          return chain;
        },
      };
      return chain;
    },
    rpc: async (fn: string, args: MergeCallsMetadataArgs) => {
      rpcCalls.push({ fn, args });
      if (rpcError) return { data: null, error: rpcError };
      if (rows[0] && beforeRpc) beforeRpc(rows[0]);
      const r = applyMergeCallsMetadataRpc(rows, args);
      return { data: r.data, error: null };
    },
  };
  return { client, rpcCalls, updates, rows };
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

  it('grava a avaliação por merge atômico, mandando só a chave de áudio, filtrando por id e org', async () => {
    const { client, rpcCalls, updates, rows } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: { api4com_call_id: 'abc' } });
    authAs('u1', client);
    const r = await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 4 });
    expect(r).toEqual({ success: true, data: { callId: CALL_ID } });
    expect(updates).toHaveLength(0);
    expect(rpcCalls).toEqual([
      { fn: 'merge_calls_metadata', args: { p_id: CALL_ID, p_patch: { audio_quality: 4 }, p_org_id: 'org-1' } },
    ]);
    expect(rows[0]?.metadata).toEqual({ api4com_call_id: 'abc', audio_quality: 4 });
  });

  it('grava as estatísticas de áudio', async () => {
    const { client, rpcCalls, rows } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: null });
    authAs('u1', client);
    await saveWebphoneCallAudio({ callId: CALL_ID, audioStats: stats });
    expect(rpcCalls[0]?.args.p_patch).toEqual({ audio_stats: stats });
    expect(rows[0]?.metadata).toEqual({ audio_stats: stats });
  });

  it('corrida de 13/11: o CRM grava o marcador entre a leitura e o merge do áudio, as duas chaves ficam', async () => {
    const marker = { applied: true, disposition: 'no_answer', rules_version: 'hangup_v1' };
    const { client, rpcCalls, rows } = supabaseWith(
      { id: CALL_ID, user_id: 'u1', metadata: { api4com_call_id: 'abc' } },
      null,
      (row) => {
        // Escrita do CRM automático no meio (merge dela, como a RPC faz).
        row.metadata = { ...(row.metadata as Record<string, unknown>), crm_auto_update: marker };
        row.sdr_disposition = 'no_answer';
      },
    );
    authAs('u1', client);
    expect(await saveWebphoneCallAudio({ callId: CALL_ID, audioStats: stats })).toEqual({ success: true, data: { callId: CALL_ID } });
    // O patch nunca carrega o metadata lido (sem api4com_call_id, sem crm_auto_update).
    expect(rpcCalls[0]?.args.p_patch).toEqual({ audio_stats: stats });
    expect(rows[0]?.metadata).toEqual({ api4com_call_id: 'abc', crm_auto_update: marker, audio_stats: stats });
    expect(rows[0]?.sdr_disposition).toBe('no_answer');
  });

  it('marcador do CRM já gravado antes do áudio continua lá depois do merge', async () => {
    const marker = { applied: true, disposition: 'no_answer', rules_version: 'hangup_v1' };
    const { client, rows } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: { crm_auto_update: marker } });
    authAs('u1', client);
    await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 3 });
    expect(rows[0]?.metadata).toEqual({ crm_auto_update: marker, audio_quality: 3 });
  });

  it('ligação de outro usuário não pode ser avaliada', async () => {
    const { client, rpcCalls } = supabaseWith({ id: CALL_ID, user_id: 'outro', metadata: {} });
    authAs('u1', client);
    const r = await saveWebphoneCallAudio({ callId: CALL_ID, audioQuality: 5 });
    expect(r).toEqual({ success: false, error: 'Só quem fez a ligação pode avaliar o áudio' });
    expect(rpcCalls).toHaveLength(0);
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
