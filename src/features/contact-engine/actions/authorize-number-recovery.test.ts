import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeNumberRecoveryAction } from './authorize-number-recovery';
import * as authModule from '@/lib/auth/get-org-id';
import * as numberHealthModule from '@/features/contact-engine/services/number-health.service';
import * as supabaseModule from '@/lib/supabase/service';
import * as fromModule from '@/lib/supabase/from';

vi.mock('@/lib/auth/get-org-id');
vi.mock('@/features/contact-engine/services/number-health.service', async () => {
  const actual = await vi.importActual<typeof import('@/features/contact-engine/services/number-health.service')>(
    '@/features/contact-engine/services/number-health.service',
  );
  return {
    ...actual,
    readNumberHealthFlag: vi.fn(),
    authorizeNumberRecovery: vi.fn(),
  };
});
vi.mock('@/lib/supabase/service');
vi.mock('@/lib/supabase/from');

describe('authorizeNumberRecoveryAction', () => {
  const mockManager = { orgId: 'org-1', userId: 'user-1', supabase: {} as any };
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue(mockDb);
  });

  it('rejeita sessao invalida', async () => {
    vi.spyOn(authModule, 'getManagerOrgId').mockRejectedValue(new Error('Unauthorized'));

    const result = await authorizeNumberRecoveryAction('inst-1', 'justificativa valida com mais de dez caracteres');
    expect(result).toEqual({ success: false, error: 'Acesso negado', code: 'forbidden' });
  });

  it('rejeita justificativa com menos de 10 caracteres', async () => {
    vi.spyOn(authModule, 'getManagerOrgId').mockResolvedValue(mockManager);

    const result = await authorizeNumberRecoveryAction('inst-1', 'curta');
    expect(result).toEqual({
      success: false,
      error: 'Justificativa deve ter no minimo 10 caracteres',
      code: 'invalid_input',
    });
  });

  it('rejeita quando flag esta desligada', async () => {
    vi.spyOn(authModule, 'getManagerOrgId').mockResolvedValue(mockManager);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('off');

    const result = await authorizeNumberRecoveryAction('inst-1', 'justificativa valida com mais de dez caracteres');
    expect(result).toEqual({ success: false, error: 'Saude por numero desativada', code: 'flag_disabled' });
  });

  it('rejeita quando instancia nao pertence a organizacao', async () => {
    vi.spyOn(authModule, 'getManagerOrgId').mockResolvedValue(mockManager);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('on');

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    });
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);

    const result = await authorizeNumberRecoveryAction('inst-1', 'justificativa valida com mais de dez caracteres');
    expect(result).toEqual({
      success: false,
      error: 'Numero nao encontrado ou nao pertence a sua organizacao',
      code: 'not_found',
    });
  });

  it('rejeita quando instancia nao esta pausada', async () => {
    vi.spyOn(authModule, 'getManagerOrgId').mockResolvedValue(mockManager);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('on');

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'inst-1',
                  org_id: 'org-1',
                  status: 'connected',
                  health_state: 'warming',
                  health_pause_reason: null,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);

    const result = await authorizeNumberRecoveryAction('inst-1', 'justificativa valida com mais de dez caracteres');
    expect(result).toEqual({
      success: false,
      error: 'Numero nao esta pausado pela saude',
      code: 'not_blocked',
    });
  });

  it('rejeita quando whatsapp nao esta conectado', async () => {
    vi.spyOn(authModule, 'getManagerOrgId').mockResolvedValue(mockManager);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('on');

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'inst-1',
                  org_id: 'org-1',
                  status: 'disconnected',
                  health_state: 'paused',
                  health_pause_reason: 'session_disconnected',
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);

    const result = await authorizeNumberRecoveryAction('inst-1', 'justificativa valida com mais de dez caracteres');
    expect(result).toEqual({
      success: false,
      error: 'Reconecte o WhatsApp antes de recuperar',
      code: 'not_connected',
    });
  });

  it('recupera numero pausado com sucesso', async () => {
    vi.spyOn(authModule, 'getManagerOrgId').mockResolvedValue(mockManager);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('on');

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'inst-1',
                  org_id: 'org-1',
                  status: 'connected',
                  health_state: 'paused',
                  health_pause_reason: 'session_disconnected',
                  health_state_changed_at: '2026-11-08T20:00:00+00',
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);
    vi.spyOn(numberHealthModule, 'authorizeNumberRecovery').mockResolvedValue({
      success: true,
      data: { state: 'warming' },
    });

    const note = 'justificativa valida com mais de dez caracteres';
    const first = await authorizeNumberRecoveryAction('inst-1', note);
    const second = await authorizeNumberRecoveryAction('inst-1', note);
    expect(first).toEqual({ success: true, data: { state: 'warming' } });
    expect(second).toEqual({ success: true, data: { state: 'warming' } });

    expect(numberHealthModule.authorizeNumberRecovery).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(numberHealthModule.authorizeNumberRecovery).mock.calls;
    const call = calls[0]?.[0];
    const again = calls[1]?.[0];
    if (!call || !again) throw new Error('authorizeNumberRecovery not called');

    expect(call.orgId).toBe('org-1');
    expect(call.instanceId).toBe('inst-1');
    expect(call.actor).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
      role: 'manager',
    });
    expect(call.note).toBe(note);
    expect(call.expectedBlockedAt).toBe('2026-11-08T20:00:00+00');
    expect(call.idempotencyToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(again.idempotencyToken).toBe(call.idempotencyToken);
  });
});
