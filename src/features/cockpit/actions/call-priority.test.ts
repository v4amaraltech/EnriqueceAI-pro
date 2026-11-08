import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { recordHumanCorrection } from '@/features/contact-engine/services/call-priority.service';

import { correctCallPriorityAction } from './call-priority';

vi.mock('@/lib/auth/get-org-id', () => ({ getAuthOrgIdResult: vi.fn() }));
vi.mock('@/features/contact-engine/services/call-priority.service', () => ({ recordHumanCorrection: vi.fn() }));

const LEAD = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({ success: true, data: { orgId: 'org-1', userId: 'u1', role: 'sdr', supabase: {} } } as never);
});

describe('correctCallPriorityAction', () => {
  it('usa a organização e o usuário da sessão, nunca do input', async () => {
    vi.mocked(recordHumanCorrection).mockResolvedValue({ status: 'recorded', interest: 30 });
    const r = await correctCallPriorityAction({ leadId: LEAD, interest: 30, requestId: 'r1', orgId: 'org-2', userId: 'u9' });
    expect(r).toEqual({ success: true, data: { interest: 30, duplicate: false } });
    expect(recordHumanCorrection).toHaveBeenCalledWith({ actor: { orgId: 'org-1', userId: 'u1', isManager: false }, leadId: LEAD, interest: 30, requestId: 'r1' });
  });

  it('repetição vira sucesso marcado como duplicada', async () => {
    vi.mocked(recordHumanCorrection).mockResolvedValue({ status: 'duplicate', interest: 30 });
    expect(await correctCallPriorityAction({ leadId: LEAD, interest: 30, requestId: 'r1' })).toEqual({ success: true, data: { interest: 30, duplicate: true } });
  });

  it('entrada inválida não chega ao serviço', async () => {
    expect((await correctCallPriorityAction({ leadId: 'x', interest: 30, requestId: 'r1' })).success).toBe(false);
    expect((await correctCallPriorityAction({ leadId: LEAD, interest: 101, requestId: 'r1' })).success).toBe(false);
    expect(recordHumanCorrection).not.toHaveBeenCalled();
  });

  it('flag desligada e lead de outra organização viram erro sem vazar detalhe', async () => {
    vi.mocked(recordHumanCorrection).mockResolvedValueOnce({ status: 'disabled' });
    expect(await correctCallPriorityAction({ leadId: LEAD, interest: 5, requestId: 'r1' })).toMatchObject({ success: false, code: 'flag_disabled' });
    vi.mocked(recordHumanCorrection).mockResolvedValueOnce({ status: 'not_found' });
    expect(await correctCallPriorityAction({ leadId: LEAD, interest: 5, requestId: 'r2' })).toEqual({ success: false, error: 'Lead não encontrado' });
  });
});
