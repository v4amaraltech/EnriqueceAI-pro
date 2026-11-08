import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  anyScope: vi.fn(),
  auth: vi.fn(),
  fetchOutcome: vi.fn(),
  arm: vi.fn(),
}));
vi.mock('../services/cockpit-outcomes-flag', () => ({
  isCallCockpitOutcomesEnabled: mocks.flag,
  isCallCockpitOutcomesEnabledForAnyScope: mocks.anyScope,
}));
vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: mocks.auth }));
vi.mock('../services/call-outcome.service', () => ({ fetchCockpitCallOutcome: mocks.fetchOutcome, armCockpitCallOutcome: mocks.arm }));

import { armCockpitCallOutcomeAction, getCockpitCallOutcome } from './call-outcome';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000002';

describe('actions de resultado do cockpit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anyScope.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({ success: true, data: { orgId: 'o', userId: 'u', role: 'sdr', supabase: {} } });
  });

  it('flag desligada: leitura responde disabled sem autenticar nem consultar ligações', async () => {
    mocks.anyScope.mockResolvedValue(false);
    expect(await getCockpitCallOutcome({ callId: CALL_ID })).toEqual({ success: true, data: { status: 'disabled' } });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.fetchOutcome).not.toHaveBeenCalled();
  });

  it('flag liberada para outra organização: responde disabled depois de autenticar, sem consultar ligações', async () => {
    mocks.flag.mockResolvedValue(false);
    expect(await getCockpitCallOutcome({ callId: CALL_ID })).toEqual({ success: true, data: { status: 'disabled' } });
    expect(mocks.flag).toHaveBeenCalledWith({ orgId: 'o', userId: 'u' });
    expect(mocks.fetchOutcome).not.toHaveBeenCalled();
  });

  it('flag desligada: armar não escreve nada (comportamento idêntico ao atual)', async () => {
    mocks.flag.mockResolvedValue(false);
    expect(await armCockpitCallOutcomeAction({ callId: CALL_ID })).toEqual({ success: true, data: { armed: false } });
    expect(mocks.arm).not.toHaveBeenCalled();
  });

  it('flag ligada: delega ao serviço com o papel do usuário', async () => {
    mocks.flag.mockResolvedValue(true);
    mocks.fetchOutcome.mockResolvedValue({ status: 'not_found' });
    await getCockpitCallOutcome({ callId: CALL_ID });
    expect(mocks.fetchOutcome).toHaveBeenCalledWith({}, { orgId: 'o', userId: 'u', isManager: false }, CALL_ID);
  });

  it('rejeita id inválido', async () => {
    expect(await getCockpitCallOutcome({ callId: 'x' })).toEqual({ success: false, error: 'Dados inválidos' });
    expect(await armCockpitCallOutcomeAction({ callId: 'x' })).toEqual({ success: false, error: 'Dados inválidos' });
  });
});
