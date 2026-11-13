import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWebphoneCallOutcome } from './get-webphone-call-outcome';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/lib/auth/get-org-id', () => auth);

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000002';

function supabaseWith(
  row: Record<string, unknown> | null,
  error: { message: string } | null = null,
) {
  const filters: Array<[string, string]> = [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: string) => {
      filters.push([col, val]);
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: row, error }),
  };
  return { client: { from: () => chain }, filters };
}

describe('getWebphoneCallOutcome', () => {
  beforeEach(() => {
    auth.getAuthOrgIdResult.mockReset();
  });

  it('rejeita id inválido antes de autenticar', async () => {
    const r = await getWebphoneCallOutcome({ callId: 'nope' });
    expect(r).toEqual({ success: false, error: 'Dados inválidos' });
    expect(auth.getAuthOrgIdResult).not.toHaveBeenCalled();
  });

  it('filtra pela org e traduz a linha em "não atendida"', async () => {
    const { client, filters } = supabaseWith({
      answered_at: null,
      hangup_cause: 'NUMBER_CHANGED',
      duration_seconds: 0,
    });
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u1', supabase: client },
    });

    const r = await getWebphoneCallOutcome({ callId: CALL_ID });

    expect(r).toEqual({
      success: true,
      data: {
        leadAnswer: 'not_answered',
        durationSeconds: 0,
        hangupCause: 'NUMBER_CHANGED',
        sdrDisposition: null,
        autoUpdateMarker: null,
        liveAmd: null,
      },
    });
    expect(filters).toEqual([
      ['id', CALL_ID],
      ['org_id', 'org-1'],
    ]);
  });

  it('webhook ainda não chegou → desconhecido', async () => {
    const { client } = supabaseWith({ answered_at: null, hangup_cause: null, duration_seconds: 0 });
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u1', supabase: client },
    });
    const r = await getWebphoneCallOutcome({ callId: CALL_ID });
    expect(r).toEqual({
      success: true,
      data: {
        leadAnswer: 'unknown',
        durationSeconds: 0,
        hangupCause: null,
        sdrDisposition: null,
        autoUpdateMarker: null,
        liveAmd: null,
      },
    });
  });

  it('linha de outra org (ou inexistente) → não encontrada', async () => {
    const { client } = supabaseWith(null);
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u1', supabase: client },
    });
    const r = await getWebphoneCallOutcome({ callId: CALL_ID });
    expect(r).toEqual({ success: false, error: 'Ligação não encontrada' });
  });

  it('devolve marcador automático e sugestão live_amd do metadata', async () => {
    const { client } = supabaseWith({
      answered_at: '2026-11-13T10:00:00.000Z',
      hangup_cause: 'NORMAL_CLEARING',
      duration_seconds: 95,
      sdr_disposition: 'technical_failure',
      metadata: {
        crm_auto_update: {
          applied: true,
          disposition: 'technical_failure',
          rules_version: 'hangup_v1',
          source: 'crm_auto_update_v1_live',
        },
        live_amd: {
          prediction: 'number_not_exist',
          next_activity_suggestion: 'not_connected',
          next_activity_reason: 'Número não existe.',
        },
      },
    });
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u1', supabase: client },
    });
    const r = await getWebphoneCallOutcome({ callId: CALL_ID });
    expect(r).toEqual({
      success: true,
      data: {
        leadAnswer: 'answered',
        durationSeconds: 95,
        hangupCause: 'NORMAL_CLEARING',
        sdrDisposition: 'technical_failure',
        autoUpdateMarker: {
          applied: true,
          disposition: 'technical_failure',
          rules_version: 'hangup_v1',
          source: 'crm_auto_update_v1_live',
        },
        liveAmd: {
          prediction: 'number_not_exist',
          nextActivity: 'not_connected',
          nextActivityReason: 'Número não existe.',
          confidence: null,
        },
      },
    });
  });
});
