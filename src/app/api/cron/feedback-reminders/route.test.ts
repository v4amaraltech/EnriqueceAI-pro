import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/auth/verify-cron-secret', () => ({
  verifyCronSecret: vi.fn(() => true),
}));

vi.mock('@/lib/email/platform-email', () => ({
  sendPlatformEmail: vi.fn(),
}));

vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: vi.fn(),
}));

vi.mock('@/features/integrations/services/whatsapp.service', () => ({
  validateBrazilianPhone: vi.fn(() => false),
}));

vi.mock('@/features/integrations/services/whatsapp-evolution.service', () => ({
  EvolutionWhatsAppService: { sendMessage: vi.fn() },
}));

vi.mock('@/features/leads/services/feedback-messenger.service', () => ({
  getFeedbackMessengerUserId: vi.fn(),
}));

vi.mock('@/features/leads/services/crm-push.service', () => ({
  pushConfirmedMeetingToCrm: vi.fn(),
}));

vi.mock('@/features/leads/services/crm-reconcile.service', () => ({
  reconcileConfirmedMeetingsToCrm: vi.fn(),
}));

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { pushConfirmedMeetingToCrm } from '@/features/leads/services/crm-push.service';
import { reconcileConfirmedMeetingsToCrm } from '@/features/leads/services/crm-reconcile.service';

import { POST } from './route';

function req() {
  return new Request('https://example.com/api/cron/feedback-reminders', {
    method: 'POST',
    headers: { authorization: 'Bearer cron' },
  });
}

describe('cron feedback-reminders — reconciliação do CRM', () => {
  beforeEach(() => {
    resetMocks();
    vi.mocked(verifyCronSecret).mockReturnValue(true);
    // Sem lembretes pendentes nem feedback vencido: toda consulta devolve vazio.
    mockFrom.mockImplementation(() => createQueryBuilder());
    vi.mocked(reconcileConfirmedMeetingsToCrm).mockResolvedValue({
      orgs: 1,
      candidates: 3,
      recovered: 2,
      notCreated: 0,
      failed: 1,
      recoveredLeadIds: ['l-1', 'l-2'],
      abortedByNetwork: false,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('rejeita sem CRON_SECRET', async () => {
    vi.mocked(verifyCronSecret).mockReturnValueOnce(false);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(reconcileConfirmedMeetingsToCrm).not.toHaveBeenCalled();
  });

  it('roda a reconciliação diária depois dos lembretes e devolve os contadores', async () => {
    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(reconcileConfirmedMeetingsToCrm).toHaveBeenCalledTimes(1);
    expect(json).toMatchObject({
      reminders: 0,
      crmPushed: 0,
      crmReconciled: 2,
      crmReconcileCandidates: 3,
      crmReconcileFailed: 1,
      crmReconcileAborted: false,
    });
    // sem feedback vencido não há push avulso
    expect(pushConfirmedMeetingToCrm).not.toHaveBeenCalled();
  });

  it('erro inesperado na reconciliação não derruba o cron', async () => {
    vi.mocked(reconcileConfirmedMeetingsToCrm).mockRejectedValueOnce(new Error('boom'));

    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ crmReconciled: 0, crmReconcileError: true });
  });
});
