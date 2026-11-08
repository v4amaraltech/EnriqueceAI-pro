import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ flag: vi.fn(), auth: vi.fn(), state: vi.fn(), record: vi.fn() }));
vi.mock('@/features/contact-engine/services/flag-scope.service', () => ({ isScopedFlagEnabled: mocks.flag }));
vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: mocks.auth }));
vi.mock('../services/verbal-consent.service', () => ({ getVerbalConsentState: mocks.state, recordVerbalConsent: mocks.record }));

import { getVerbalConsentStateAction, recordVerbalConsentAction } from './verbal-consent';

const CALL_ID = '6f1c2a3e-0000-4000-8000-000000000002';

describe('actions do aceite verbal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ success: true, data: { orgId: 'o', userId: 'u', role: 'sdr', supabase: {} } });
    mocks.flag.mockResolvedValue(true);
  });

  it('flag desligada: o botao nao aparece e nenhuma ligacao e lida', async () => {
    mocks.flag.mockResolvedValue(false);
    expect(await getVerbalConsentStateAction({ callId: CALL_ID })).toEqual({ success: true, data: { state: 'disabled' } });
    expect(mocks.flag).toHaveBeenCalledWith('consent_capture_v1', { orgId: 'o' });
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it('flag desligada: registrar e recusado sem tocar em dados', async () => {
    mocks.flag.mockResolvedValue(false);
    expect(await recordVerbalConsentAction({ callId: CALL_ID })).toMatchObject({ success: false, code: 'flag_disabled' });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('id invalido e sessao ausente', async () => {
    expect(await recordVerbalConsentAction({ callId: 'x' })).toMatchObject({ success: false });
    mocks.auth.mockResolvedValue({ success: false, error: 'Organização não encontrada' });
    expect(await getVerbalConsentStateAction({ callId: CALL_ID })).toMatchObject({ success: false });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('flag ligada: delega com o papel do usuario e traduz os resultados', async () => {
    mocks.state.mockResolvedValue('available');
    expect(await getVerbalConsentStateAction({ callId: CALL_ID })).toEqual({ success: true, data: { state: 'available' } });
    expect(mocks.state).toHaveBeenCalledWith({}, { orgId: 'o', userId: 'u', isManager: false }, CALL_ID);

    mocks.record.mockResolvedValueOnce({ status: 'recorded' });
    expect(await recordVerbalConsentAction({ callId: CALL_ID })).toEqual({ success: true, data: { alreadyRecorded: false } });
    mocks.record.mockResolvedValueOnce({ status: 'already_recorded' });
    expect(await recordVerbalConsentAction({ callId: CALL_ID })).toEqual({ success: true, data: { alreadyRecorded: true } });
    mocks.record.mockResolvedValueOnce({ status: 'not_answered' });
    expect(await recordVerbalConsentAction({ callId: CALL_ID })).toMatchObject({ success: false, code: 'not_answered' });
    mocks.record.mockResolvedValueOnce({ status: 'not_found' });
    expect(await recordVerbalConsentAction({ callId: CALL_ID })).toMatchObject({ success: false, code: 'not_found' });
  });
});
