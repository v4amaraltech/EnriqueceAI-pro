import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import * as authModule from '@/lib/auth/verify-cron-secret';
import * as numberHealthModule from '@/features/contact-engine/services/number-health.service';
import * as supabaseModule from '@/lib/supabase/service';
import * as fromModule from '@/lib/supabase/from';

vi.mock('@/lib/auth/verify-cron-secret');
vi.mock('@/features/contact-engine/services/number-health.service');
vi.mock('@/lib/supabase/service');
vi.mock('@/lib/supabase/from');

describe('/api/cron/evaluate-number-health', () => {
  const mockRequest = (secret: string = 'Bearer valid-secret') =>
    new Request('http://localhost:3000/api/cron/evaluate-number-health', {
      method: 'POST',
      headers: { authorization: secret },
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita requisicao sem cron secret valido', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(false);

    const response = await POST(mockRequest('Bearer invalid'));
    expect(response.status).toBe(401);

    const json = await response.json();
    expect(json).toEqual({ error: 'Unauthorized' });
    expect(authModule.verifyCronSecret).toHaveBeenCalledTimes(1);
  });

  it('nao avalia nada quando flag esta desligada globalmente sem orgs permitidas', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);

    const mockDb = {} as any;
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [{ key: 'number_health_v1', enabled: false, allow_org_ids: [] }],
            error: null,
          }),
        }),
      }),
    });

    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue(mockDb);
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);

    const response = await POST(mockRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual({ evaluated: 0, skipped: 'flag_disabled' });
  });

  it('avalia instancias quando flag esta ligada globalmente', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);

    const mockDb = {} as any;
    let callCount = 0;
    const mockFrom = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Primeira chamada: le flag
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ key: 'number_health_v1', enabled: true, allow_org_ids: [] }],
                error: null,
              }),
            }),
          }),
        };
      }
      // Segunda chamada: le instancias
      return {
        select: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: 'inst-1', org_id: 'org-1', instance_name: 'Test Instance' },
              ],
              error: null,
            }),
          }),
        }),
      };
    });

    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue(mockDb);
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('on');
    vi.spyOn(numberHealthModule, 'runNumberHealthEvaluation').mockResolvedValue({
      success: true,
      data: { applied: true, reason: null, state: 'warming', paused: false, rampAdvanced: false, rampFrozen: false, blockers: [] },
    });

    const response = await POST(mockRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toMatchObject({ evaluated: 1, skipped: 0, failed: 0, total: 1 });
    expect(numberHealthModule.runNumberHealthEvaluation).toHaveBeenCalledWith({
      orgId: 'org-1',
      instanceId: 'inst-1',
    });
  });

  it('pula instancias quando flag esta desligada por org', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);

    const mockDb = {} as any;
    let callCount = 0;
    const mockFrom = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ key: 'number_health_v1', enabled: true, allow_org_ids: [] }],
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: 'inst-1', org_id: 'org-1', instance_name: 'Test Instance' },
              ],
              error: null,
            }),
          }),
        }),
      };
    });

    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue(mockDb);
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('off');

    const response = await POST(mockRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toMatchObject({ evaluated: 0, skipped: 1, failed: 0, total: 1 });
    expect(numberHealthModule.runNumberHealthEvaluation).not.toHaveBeenCalled();
  });

  it('conta falhas quando avaliacao lanca excecao', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);

    const mockDb = {} as any;
    let callCount = 0;
    const mockFrom = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ key: 'number_health_v1', enabled: true, allow_org_ids: [] }],
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: 'inst-1', org_id: 'org-1', instance_name: 'Test Instance' },
              ],
              error: null,
            }),
          }),
        }),
      };
    });

    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue(mockDb);
    vi.spyOn(fromModule, 'from').mockImplementation(mockFrom as any);
    vi.spyOn(numberHealthModule, 'readNumberHealthFlag').mockResolvedValue('on');
    vi.spyOn(numberHealthModule, 'runNumberHealthEvaluation').mockRejectedValue(new Error('Database error'));

    const response = await POST(mockRequest());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toMatchObject({ evaluated: 0, skipped: 0, failed: 1, total: 1 });
  });
});
