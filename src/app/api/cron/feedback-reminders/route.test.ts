import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };
const deliver = vi.fn();
const sendPlatformEmail = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (t: string) => unknown }, table: string) => client.from(table),
}));

vi.mock('@/lib/auth/verify-cron-secret', () => ({
  verifyCronSecret: () => true,
}));

vi.mock('@/lib/email/platform-email', () => ({
  sendPlatformEmail: (...args: unknown[]) => sendPlatformEmail(...args),
}));

vi.mock('@/lib/utils/app-url', () => ({ getAppUrl: () => 'https://app.test' }));

vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: () => Promise.resolve(),
}));

vi.mock('@/features/leads/services/crm-push.service', () => ({
  pushConfirmedMeetingToCrm: () => Promise.resolve({ dealCreated: false }),
}));

vi.mock('@/features/leads/services/feedback-messenger.service', () => ({
  getFeedbackMessengerUserId: () => Promise.resolve(null),
}));

vi.mock('@/features/leads/services/closer-feedback-delivery.service', () => ({
  FEEDBACK_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  deliverCloserFeedbackRequest: (...args: unknown[]) => deliver(...args),
}));

import { POST } from './route';

const CHAIN_METHODS = ['select', 'eq', 'in', 'is', 'not', 'gt', 'lt', 'gte', 'or', 'order', 'limit', 'update'] as const;

/**
 * Builder que grava os filtros chamados e resolve pelo `resolver`, que recebe
 * o que foi chamado — assim a mesma tabela responde diferente para a fila de
 * envio adiado (`is('sent_at', null)`) e para os lembretes.
 */
function chain(resolver: (calls: Array<[string, unknown[]]>) => Record<string, unknown>) {
  const calls: Array<[string, unknown[]]> = [];
  const c: Record<string, unknown> = {};
  for (const m of CHAIN_METHODS) {
    c[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      return c;
    });
  }
  c.maybeSingle = vi.fn(() => Promise.resolve(resolver(calls)));
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolver(calls)).then(resolve, reject);
  return c;
}

const UNSENT = {
  id: 'req-1',
  token: 'tok-1',
  lead_id: 'lead-1',
  closer_id: 'closer-1',
  org_id: 'org-1',
  expires_at: new Date(Date.now() + 5 * 86400_000).toISOString(),
};

function setup(lead: { status?: string; meeting_starts_at: string | null; deleted_at?: string | null }) {
  const requestUpdates: Array<Record<string, unknown>> = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'closer_feedback_requests') {
      return chain((calls) => {
        const update = calls.find(([m]) => m === 'update');
        if (update) {
          requestUpdates.push(update[1][0] as Record<string, unknown>);
          return { data: [{ id: UNSENT.id }], error: null };
        }
        const isUnsentQueue = calls.some(([m, args]) => m === 'is' && args[0] === 'sent_at' && args[1] === null);
        return { data: isUnsentQueue ? [UNSENT] : [], error: null };
      });
    }
    if (table === 'leads') {
      return chain(() => ({
        data: [
          {
            id: 'lead-1',
            status: lead.status ?? 'won',
            deleted_at: lead.deleted_at ?? null,
            meeting_starts_at: lead.meeting_starts_at,
            nome_fantasia: 'NEXT360 Telecom',
            razao_social: null,
            assigned_to: 'sdr-1',
          },
        ],
        error: null,
      }));
    }
    if (table === 'closers') {
      return chain(() => ({
        data: [{ id: 'closer-1', name: 'Jhonata', email: 'j@x.com', phone: null }],
        error: null,
      }));
    }
    return chain(() => ({ data: [], error: null }));
  });
  return { requestUpdates };
}

const request = () => new Request('https://example.com/api/cron/feedback-reminders', { method: 'POST' });

describe('feedback-reminders — envio adiado (Ganho antes da reunião)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deliver.mockResolvedValue({ email: 'sent', whatsapp: 'skipped' });
    sendPlatformEmail.mockResolvedValue({ success: true });
  });

  it('reunião já começou: entrega o link pelo serviço e conta como enviado', async () => {
    setup({ meeting_starts_at: new Date(Date.now() - 10 * 60_000).toISOString() });

    const res = await POST(request());
    const body = await res.json();

    expect(body).toMatchObject({ scheduledSent: 1, scheduledWaiting: 0, scheduledErrors: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        requestId: 'req-1',
        token: 'tok-1',
        closerEmail: 'j@x.com',
        leadName: 'NEXT360 Telecom',
        performedBy: 'sdr-1',
        stampSentAt: true,
      }),
    );
  });

  it('reunião ainda no futuro: não envia e estende expires_at para cobrir reunião + 7 dias', async () => {
    const meetingStartsAt = new Date(Date.now() + 2 * 86400_000).toISOString();
    const { requestUpdates } = setup({ meeting_starts_at: meetingStartsAt });

    const res = await POST(request());
    const body = await res.json();

    expect(body).toMatchObject({ scheduledSent: 0, scheduledWaiting: 1 });
    expect(deliver).not.toHaveBeenCalled();
    expect(requestUpdates).toHaveLength(1);
    expect(new Date(requestUpdates[0]!.expires_at as string).getTime()).toBe(
      new Date(meetingStartsAt).getTime() + 7 * 86400_000,
    );
  });

  it('lead que saiu de "won" antes da reunião não é cobrado', async () => {
    setup({ status: 'unqualified', meeting_starts_at: new Date(Date.now() - 3600_000).toISOString() });

    const res = await POST(request());
    const body = await res.json();

    expect(body).toMatchObject({ scheduledSent: 0, scheduledWaiting: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('dois canais falhando contam como erro e a linha fica para a próxima rodada', async () => {
    deliver.mockResolvedValue({ email: 'failed', whatsapp: 'failed', emailError: 'resend_down' });
    setup({ meeting_starts_at: null });

    const res = await POST(request());
    const body = await res.json();

    expect(body).toMatchObject({ scheduledSent: 0, scheduledErrors: 1 });
  });

  it('lembretes e fallback do CRM só olham linhas já enviadas (sent_at)', async () => {
    setup({ meeting_starts_at: new Date(Date.now() - 3600_000).toISOString() });

    await POST(request());

    // Toda consulta de lembrete/fallback na tabela passou por .not('sent_at', 'is', null).
    const feedbackChains = mockFrom.mock.results
      .map((r, i) => [mockFrom.mock.calls[i]?.[0], r.value] as const)
      .filter(([table]) => table === 'closer_feedback_requests')
      .map(([, c]) => c as Record<string, ReturnType<typeof vi.fn>>);
    const notCalls = feedbackChains.flatMap((c) => c.not!.mock.calls);
    expect(notCalls.filter(([col, op, val]) => col === 'sent_at' && op === 'is' && val === null)).toHaveLength(2);
  });
});
