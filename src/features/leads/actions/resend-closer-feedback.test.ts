import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: () =>
    Promise.resolve({ success: true, data: { orgId: 'org-1', userId: 'user-1', supabase: mockSupabase } }),
}));

const sendCloserFeedbackEmail = vi.fn();
vi.mock('./send-closer-feedback', () => ({
  sendCloserFeedbackEmail: (...args: unknown[]) => sendCloserFeedbackEmail(...args),
}));

import { resendCloserFeedback } from './resend-closer-feedback';

const LEAD_ID = '11111111-1111-4111-8111-111111111111';

function installFake(opts: { leadStatus: string; pending: boolean; closer?: boolean }) {
  mockFrom.mockImplementation((table: string) => {
    const b = createQueryBuilder();
    if (table === 'leads') {
      b.maybeSingle = vi.fn(() =>
        Promise.resolve({
          data: { id: LEAD_ID, status: opts.leadStatus, closer_id: 'closer-1', nome_fantasia: 'NEXT360', razao_social: null },
          error: null,
        }),
      );
    }
    if (table === 'closers') {
      b.maybeSingle = vi.fn(() =>
        Promise.resolve({
          data: opts.closer === false ? null : { id: 'closer-1', name: 'Jhonata', email: 'j@x.com', phone: null },
          error: null,
        }),
      );
    }
    if (table === 'closer_feedback_requests') {
      b.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.pending ? { id: 'req-1' } : null, error: null }));
    }
    return b;
  });
}

describe('resendCloserFeedback', () => {
  beforeEach(() => {
    resetMocks();
    sendCloserFeedbackEmail.mockReset();
    sendCloserFeedbackEmail.mockResolvedValue({ email: 'sent', whatsapp: 'skipped' });
  });

  it('lead ganho sem request nenhum: cria e envia (recuperação pelo gestor)', async () => {
    installFake({ leadStatus: 'won', pending: false });

    const result = await resendCloserFeedback({ leadId: LEAD_ID });

    expect(result.success).toBe(true);
    expect(sendCloserFeedbackEmail).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: LEAD_ID, closerId: 'closer-1', closerEmail: 'j@x.com', senderUserId: 'user-1' }),
    );
  });

  it('lead fora de "won" e sem request continua recusado', async () => {
    installFake({ leadStatus: 'qualified', pending: false });

    const result = await resendCloserFeedback({ leadId: LEAD_ID });

    expect(result).toEqual({ success: false, error: 'Nenhum feedback pendente para este lead' });
    expect(sendCloserFeedbackEmail).not.toHaveBeenCalled();
  });

  it('lead fora de "won" com request pendente ainda reenvia', async () => {
    installFake({ leadStatus: 'qualified', pending: true });

    const result = await resendCloserFeedback({ leadId: LEAD_ID });

    expect(result.success).toBe(true);
    expect(sendCloserFeedbackEmail).toHaveBeenCalledTimes(1);
  });

  it('reunião ainda no futuro: devolve sucesso com o envio agendado', async () => {
    installFake({ leadStatus: 'won', pending: false });
    const scheduledFor = new Date(Date.now() + 3600_000).toISOString();
    sendCloserFeedbackEmail.mockResolvedValue({ email: 'scheduled', whatsapp: 'skipped', emailError: 'meeting_in_future', scheduledFor });

    const result = await resendCloserFeedback({ leadId: LEAD_ID });

    expect(result).toEqual({
      success: true,
      data: { email: 'scheduled', whatsapp: 'skipped', emailError: 'meeting_in_future', scheduledFor },
    });
  });

  it('closer que já confirmou a reunião: mensagem legível', async () => {
    installFake({ leadStatus: 'won', pending: false });
    sendCloserFeedbackEmail.mockResolvedValue({ email: 'failed', whatsapp: 'skipped', emailError: 'already_answered_recently' });

    const result = await resendCloserFeedback({ leadId: LEAD_ID });

    expect(result).toEqual({ success: false, error: 'O closer já respondeu o feedback desta reunião' });
  });
});
