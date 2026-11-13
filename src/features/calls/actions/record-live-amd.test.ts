import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const flag = vi.hoisted(() => ({ isWebphoneLiveAmdEnabled: vi.fn() }));
const activity = vi.hoisted(() => ({ suggestNextActivity: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/features/integrations/webphone/live-amd-flag', () => flag);
vi.mock('@/features/calls/live-amd-next-activity', () => activity);

import { applyMergeCallsMetadataRpc, type MergeCallsMetadataArgs } from '@tests/mocks/merge-calls-metadata';

import { recordLiveAmd } from './record-live-amd';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000001';

/** Supabase falso: select devolve cópia de `row`; a RPC aplica metadata || patch na linha. */
function supabaseWith(row: Record<string, unknown> | null, beforeRpc?: (row: Record<string, unknown>) => void) {
  const rows: Array<Record<string, unknown>> = row ? [{ org_id: 'org-1', ...row }] : [];
  const updates: unknown[] = [];
  const rpcCalls: Array<{ fn: string; args: MergeCallsMetadataArgs }> = [];
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
      if (rows[0] && beforeRpc) beforeRpc(rows[0]);
      return { data: applyMergeCallsMetadataRpc(rows, args).data, error: null };
    },
  };
  return { client, updates, rpcCalls, rows };
}

const input = {
  callId: CALL_ID,
  prediction: 'voicemail',
  phrase: 'caixa postal',
  confidence: 0.92,
  latencyMs: 1800,
  predictedAt: '2026-11-10T22:00:00.000Z',
  transcript: 'encaminhada para a caixa postal',
  requestNextActivity: true,
};

describe('recordLiveAmd', () => {
  beforeEach(() => {
    auth.getAuthOrgIdResult.mockReset();
    flag.isWebphoneLiveAmdEnabled.mockReset();
    activity.suggestNextActivity.mockReset();
  });

  it('grava live_amd e a sugestão sem preencher desfecho, status ou connected', async () => {
    const { client, updates, rpcCalls, rows } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: { api4com_call_id: 'abc' } });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', role: 'sdr', supabase: client } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(true);
    activity.suggestNextActivity.mockResolvedValue({ suggestion: 'not_connected', reason: 'Caiu na caixa postal.', confidence: 0.8 });

    const result = await recordLiveAmd(input);

    expect(result).toEqual({ success: true, data: { callId: CALL_ID, nextActivity: 'not_connected', nextActivityReason: 'Caiu na caixa postal.' } });
    expect(updates).toHaveLength(0);
    const liveAmd = {
      prediction: 'voicemail',
      phrase: 'caixa postal',
      confidence: 0.92,
      latency_ms: 1800,
      predicted_at: '2026-11-10T22:00:00.000Z',
      transcript: 'encaminhada para a caixa postal',
      next_activity_suggestion: 'not_connected',
      next_activity_reason: 'Caiu na caixa postal.',
      next_activity_confidence: 0.8,
    };
    // Só a chave live_amd vai no patch; sem desfecho, status nem connected.
    expect(rpcCalls).toEqual([
      { fn: 'merge_calls_metadata', args: { p_id: CALL_ID, p_patch: { live_amd: liveAmd }, p_org_id: 'org-1' } },
    ]);
    expect(rows[0]?.metadata).toEqual({ api4com_call_id: 'abc', live_amd: liveAmd });
    expect(rows[0]).not.toHaveProperty('sdr_disposition');
  });

  it('live_amd não apaga o marcador do CRM gravado no meio', async () => {
    const marker = { applied: true, disposition: 'no_answer', rules_version: 'hangup_v1' };
    const { client, rows } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: {} }, (row) => {
      row.metadata = { ...(row.metadata as Record<string, unknown>), crm_auto_update: marker };
    });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', role: 'sdr', supabase: client } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(true);
    expect((await recordLiveAmd({ ...input, requestNextActivity: false })).success).toBe(true);
    expect(rows[0]?.metadata).toMatchObject({ crm_auto_update: marker, live_amd: { prediction: 'voicemail' } });
  });

  it('preserva subchaves antigas do próprio live_amd', async () => {
    const { client, rpcCalls } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: { live_amd: { reviewed: true } } });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', role: 'sdr', supabase: client } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(true);
    await recordLiveAmd({ ...input, requestNextActivity: false });
    expect(Object.keys(rpcCalls[0]?.args.p_patch ?? {})).toEqual(['live_amd']);
    expect(rpcCalls[0]?.args.p_patch.live_amd).toMatchObject({ reviewed: true, prediction: 'voicemail' });
  });

  it('com a flag desligada não escreve na ligação', async () => {
    const { client, updates, rpcCalls } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: {} });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', role: 'sdr', supabase: client } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(false);
    expect(await recordLiveAmd(input)).toEqual({ success: false, error: 'Piloto desligado' });
    expect(updates).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(activity.suggestNextActivity).not.toHaveBeenCalled();
  });
});
