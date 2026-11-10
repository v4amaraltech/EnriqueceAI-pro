import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const flag = vi.hoisted(() => ({ isWebphoneLiveAmdEnabled: vi.fn() }));
const activity = vi.hoisted(() => ({ suggestNextActivity: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/features/integrations/webphone/live-amd-flag', () => flag);
vi.mock('@/features/calls/live-amd-next-activity', () => activity);

import { recordLiveAmd } from './record-live-amd';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000001';

function supabaseWith(row: Record<string, unknown> | null) {
  const updates: Array<{ payload: Record<string, unknown> }> = [];
  const client = {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
        update: (payload: Record<string, unknown>) => {
          updates.push({ payload });
          const upd: Record<string, unknown> = {
            eq: () => upd,
            then: (resolve: (value: unknown) => void) => resolve({ error: null }),
          };
          return upd;
        },
      };
      return chain;
    },
  };
  return { client, updates };
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
    const { client, updates } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: { api4com_call_id: 'abc' } });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', role: 'sdr', supabase: client } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(true);
    activity.suggestNextActivity.mockResolvedValue({ suggestion: 'not_connected', reason: 'Caiu na caixa postal.', confidence: 0.8 });

    const result = await recordLiveAmd(input);

    expect(result).toEqual({ success: true, data: { callId: CALL_ID, nextActivity: 'not_connected', nextActivityReason: 'Caiu na caixa postal.' } });
    expect(Object.keys(updates[0]?.payload ?? {})).toEqual(['metadata', 'updated_at']);
    expect(updates[0]?.payload.metadata).toEqual({
      api4com_call_id: 'abc',
      live_amd: {
        prediction: 'voicemail',
        phrase: 'caixa postal',
        confidence: 0.92,
        latency_ms: 1800,
        predicted_at: '2026-11-10T22:00:00.000Z',
        transcript: 'encaminhada para a caixa postal',
        next_activity_suggestion: 'not_connected',
        next_activity_reason: 'Caiu na caixa postal.',
        next_activity_confidence: 0.8,
      },
    });
    expect(JSON.stringify(updates[0]?.payload)).not.toContain('sdr_disposition');
  });

  it('com a flag desligada não escreve na ligação', async () => {
    const { client, updates } = supabaseWith({ id: CALL_ID, user_id: 'u1', metadata: {} });
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', role: 'sdr', supabase: client } });
    flag.isWebphoneLiveAmdEnabled.mockResolvedValue(false);
    expect(await recordLiveAmd(input)).toEqual({ success: false, error: 'Piloto desligado' });
    expect(updates).toHaveLength(0);
    expect(activity.suggestNextActivity).not.toHaveBeenCalled();
  });
});
