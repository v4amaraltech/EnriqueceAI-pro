import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDispatcherEnabled } from './dispatcher.service';
import { readNumberHealthFlag } from './number-health.service';
import { getGatewayMode } from './send-decision.service';

const mocks = vi.hoisted(() => ({ state: vi.fn() }));

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({}) }));
vi.mock('./flag-scope.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./flag-scope.service')>();
  return {
    ...actual,
    readScopedFlagState: mocks.state,
    isScopedFlagEnabled: async (key: string, scope?: unknown) =>
      (await mocks.state(key, scope)) === 'on',
  };
});

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

/** Simula app_flags: ligada só para a organização A. */
function onlyOrgA(on: Record<string, boolean> = {}) {
  mocks.state.mockImplementation(async (key: string, scope?: { orgId?: string }) =>
    scope?.orgId === ORG_A && on[key] ? 'on' : 'off',
  );
}

describe('serviços do motor usam a leitura com escopo', () => {
  beforeEach(() => mocks.state.mockReset());

  it('dispatcher: liga só para a org liberada', async () => {
    onlyOrgA({ dispatcher_v1: true });
    expect(await isDispatcherEnabled({ orgId: ORG_A })).toBe(true);
    expect(await isDispatcherEnabled({ orgId: ORG_B })).toBe(false);
    expect(await isDispatcherEnabled()).toBe(false);
  });

  it('gateway: shadow só na org do piloto; as demais seguem off (igual a hoje)', async () => {
    onlyOrgA({ send_gateway_shadow: true });
    expect(await getGatewayMode({ orgId: ORG_A })).toBe('shadow');
    expect(await getGatewayMode({ orgId: ORG_B })).toBe('off');
    expect(await getGatewayMode()).toBe('off');
  });

  it('gateway: erro de leitura de enforced continua fail-closed', async () => {
    mocks.state.mockImplementation(async (key: string) =>
      key === 'send_gateway_enforced' ? 'error' : 'off',
    );
    expect(await getGatewayMode({ orgId: ORG_B })).toBe('enforced');
  });

  it('saúde de número: preserva o tri-estado on/off/error por org', async () => {
    onlyOrgA({ number_health_v1: true });
    expect(await readNumberHealthFlag({ orgId: ORG_A })).toBe('on');
    expect(await readNumberHealthFlag({ orgId: ORG_B })).toBe('off');
    mocks.state.mockResolvedValue('error');
    expect(await readNumberHealthFlag({ orgId: ORG_A })).toBe('error');
  });
});
