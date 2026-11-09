import { readFileSync } from 'fs';
import { join } from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';
import { HEALTH_EVALUATION_PAGE_SIZE } from './batch';
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

  const updates: Array<Record<string, unknown>> = [];

  function chain(resolved: unknown) {
    const b: Record<string, unknown> = {};
    const passthrough = () => b;
    b.select = passthrough;
    b.order = passthrough;
    b.in = passthrough;
    b.eq = passthrough;
    b.is = passthrough;
    b.update = (patch: Record<string, unknown>) => {
      updates.push(patch);
      return b;
    };
    b.limit = () => Promise.resolve(resolved);
    b.range = () => Promise.resolve(resolved);
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(ok, ko);
    return b;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
  });

  it('rejeita requisicao sem cron secret valido', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(false);

    const response = await POST(mockRequest('Bearer invalid'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('nao avalia nada quando flag esta desligada globalmente sem orgs permitidas', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);
    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue({} as never);
    vi.spyOn(fromModule, 'from').mockImplementation(
      (() =>
        chain({
          data: [{ key: 'number_health_v1', enabled: false, allow_org_ids: [], allow_user_ids: [] }],
          error: null,
        })) as never,
    );

    const response = await POST(mockRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ evaluated: 0, skipped: 'flag_disabled' });
    expect(numberHealthModule.runNumberHealthEvaluation).not.toHaveBeenCalled();
  });

  it('avalia a instancia Evolution elegivel sem filtrar deleted_at', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);
    let calls = 0;
    vi.spyOn(fromModule, 'from').mockImplementation((() => {
      calls += 1;
      if (calls === 1) {
        return chain({
          data: [{ key: 'number_health_v1', enabled: true, allow_org_ids: [], allow_user_ids: [] }],
          error: null,
        });
      }
      return chain({
        data: [{ id: 'inst-1', org_id: 'org-1', instance_name: 'evo-1' }],
        error: null,
      });
    }) as never);
    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue({} as never);
    vi.spyOn(numberHealthModule, 'runNumberHealthEvaluation').mockResolvedValue({
      success: true,
      data: {
        applied: true,
        reason: null,
        state: 'warming',
        paused: false,
        rampAdvanced: false,
        rampFrozen: false,
        blockers: [],
      },
    });

    const response = await POST(mockRequest());
    expect(await response.json()).toMatchObject({ evaluated: 1, skipped: 0, failed: 0, total: 1 });
    expect(numberHealthModule.runNumberHealthEvaluation).toHaveBeenCalledWith({
      orgId: 'org-1',
      instanceId: 'inst-1',
    });
    expect(updates).toEqual([]);
  });

  it('passa da primeira pagina de orgs desligadas e avalia a org ligada', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);
    const offPage = Array.from({ length: HEALTH_EVALUATION_PAGE_SIZE }, (_, i) => ({
      id: `off-${i}`,
      org_id: 'org-off',
      instance_name: `off-${i}`,
    }));
    let calls = 0;
    vi.spyOn(fromModule, 'from').mockImplementation((() => {
      calls += 1;
      if (calls === 1) {
        return chain({
          data: [{ key: 'number_health_v1', enabled: false, allow_org_ids: ['org-on'], allow_user_ids: [] }],
          error: null,
        });
      }
      if (calls === 2) return chain({ data: offPage, error: null });
      return chain({
        data: [{ id: 'on-1', org_id: 'org-on', instance_name: 'evo-on' }],
        error: null,
      });
    }) as never);
    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue({} as never);
    vi.spyOn(numberHealthModule, 'runNumberHealthEvaluation').mockResolvedValue({
      success: true,
      data: {
        applied: true,
        reason: null,
        state: 'healthy',
        paused: false,
        rampAdvanced: false,
        rampFrozen: false,
        blockers: [],
      },
    });

    const json = await (await POST(mockRequest())).json();
    expect(json).toMatchObject({ evaluated: 1, total: 1 });
    expect(numberHealthModule.runNumberHealthEvaluation).toHaveBeenCalledTimes(1);
    expect(numberHealthModule.runNumberHealthEvaluation).toHaveBeenCalledWith({
      orgId: 'org-on',
      instanceId: 'on-1',
    });
  });

  it('erro avanca o cursor sem mexer em estado ou freio e nao impede a proxima', async () => {
    vi.spyOn(authModule, 'verifyCronSecret').mockReturnValue(true);
    let calls = 0;
    vi.spyOn(fromModule, 'from').mockImplementation((() => {
      calls += 1;
      if (calls === 1) {
        return chain({
          data: [{ key: 'number_health_v1', enabled: true, allow_org_ids: [], allow_user_ids: [] }],
          error: null,
        });
      }
      if (calls === 2) {
        return chain({
          data: [
            { id: 'bad', org_id: 'org-1', instance_name: 'bad' },
            { id: 'good', org_id: 'org-1', instance_name: 'good' },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    }) as never);
    vi.spyOn(supabaseModule, 'createServiceRoleClient').mockReturnValue({} as never);
    vi.spyOn(numberHealthModule, 'runNumberHealthEvaluation')
      .mockRejectedValueOnce(new Error('Database error'))
      .mockResolvedValueOnce({
        success: true,
        data: {
          applied: true,
          reason: null,
          state: 'warming',
          paused: false,
          rampAdvanced: false,
          rampFrozen: false,
          blockers: [],
        },
      });

    const json = await (await POST(mockRequest())).json();
    expect(json).toMatchObject({ evaluated: 1, failed: 1, total: 2 });
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0] ?? {})).toEqual(['health_evaluated_at']);
  });

  it('o codigo da rota nao referencia deleted_at', () => {
    const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    expect(src).not.toMatch(/\.is\(\s*'deleted_at'|deleted_at IS NULL/);
  });
});