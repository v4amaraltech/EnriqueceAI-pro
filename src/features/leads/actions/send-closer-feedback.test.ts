import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

const sendPlatformEmail = vi.fn();
vi.mock('@/lib/email/platform-email', () => ({
  sendPlatformEmail: (...args: unknown[]) => sendPlatformEmail(...args),
}));

vi.mock('@/lib/utils/app-url', () => ({ getAppUrl: () => 'https://app.test' }));

// Phone path is exercised separately; default to "no manager Evolution" so the
// WhatsApp leg is skipped cleanly and these tests focus on the dedup guard.
vi.mock('@/features/leads/services/feedback-messenger.service', () => ({
  getFeedbackMessengerUserId: () => Promise.resolve(null),
}));

import { sendCloserFeedbackEmail } from './send-closer-feedback';

const BASE = {
  leadId: 'lead-1',
  orgId: 'org-1',
  closerId: 'closer-1',
  closerName: 'Vinicius',
  closerEmail: 'vini@x.com',
  closerPhone: null,
  leadName: 'Kaigen',
  senderUserId: 'user-1',
};

describe('sendCloserFeedbackEmail — duplicate-grade guard', () => {
  beforeEach(() => {
    resetMocks();
    sendPlatformEmail.mockReset();
    sendPlatformEmail.mockResolvedValue({ success: true });
  });

  it('skips creating a request when the closer already confirmed this meeting (meeting_done)', async () => {
    // Two maybeSingle() calls fire in order: (1) pending lookup → none,
    // (2) recently-answered lookup → a row, which must short-circuit.
    let maybeSingleCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'closer_feedback_requests') {
        const b = createQueryBuilder();
        b.maybeSingle = vi.fn(() => {
          maybeSingleCall += 1;
          return Promise.resolve({
            data: maybeSingleCall === 1 ? null : { id: 'answered-recently' },
            error: null,
          });
        });
        return b;
      }
      return createQueryBuilder();
    });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.emailError).toBe('already_answered_recently');
    expect(result.email).toBe('failed'); // never attempted
    expect(sendPlatformEmail).not.toHaveBeenCalled();
  });

  it('creates a request and emails when there is no recent answer', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'closer_feedback_requests') {
        const b = createQueryBuilder();
        // No pending and no recent answer → both maybeSingle() resolve null.
        b.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
        // The insert(...).select(...).single() returns the new token.
        b.single = vi.fn(() => Promise.resolve({ data: { id: 'new-req', token: 'tok-123' }, error: null }));
        return b;
      }
      return createQueryBuilder(); // interactions / meeting lookup → default nulls
    });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('sent');
    expect(sendPlatformEmail).toHaveBeenCalledTimes(1);
    expect(sendPlatformEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'vini@x.com', subject: expect.stringContaining('Kaigen') }),
    );
  });
});

/**
 * Table-aware fake: each from() call gets its own builder that records eq()
 * filters, so the pending lookup and the "already confirmed" lookup can be
 * answered differently regardless of call order.
 */
function installFake(opts: {
  pending?: { id: string; token: string; expires_at: string; sent_at?: string | null } | null;
  confirmed?: { id: string } | null;
  meetingStartsAt?: string | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const interactions: Array<Record<string, unknown>> = [];
  const pending = opts.pending ? { sent_at: '2026-01-01T00:00:00.000Z', ...opts.pending } : null;
  mockFrom.mockImplementation((table: string) => {
    const b = createQueryBuilder();
    const eqs: Array<[string, unknown]> = [];
    b.eq = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val]);
      return b;
    });
    if (table === 'interactions') {
      b.insert = vi.fn((row: Record<string, unknown>) => {
        interactions.push(row);
        return b;
      });
    }
    if (table === 'closer_feedback_requests') {
      b.update = vi.fn((row: Record<string, unknown>) => {
        updates.push(row);
        return b;
      });
      b.insert = vi.fn((row: Record<string, unknown>) => {
        inserts.push(row);
        return b;
      });
      b.maybeSingle = vi.fn(() => {
        const isConfirmedLookup = eqs.some(([c, v]) => c === 'result' && v === 'meeting_done');
        return Promise.resolve({
          data: isConfirmedLookup ? (opts.confirmed ?? null) : pending,
          error: null,
        });
      });
      b.single = vi.fn(() => Promise.resolve({ data: { id: 'new-req', token: 'tok-new' }, error: null }));
    }
    if (table === 'leads') {
      b.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: { meeting_starts_at: opts.meetingStartsAt ?? null }, error: null }),
      );
    }
    return b;
  });
  return { updates, inserts, interactions };
}

describe('sendCloserFeedbackEmail — reunião remarcada', () => {
  beforeEach(() => {
    resetMocks();
    sendPlatformEmail.mockReset();
    sendPlatformEmail.mockResolvedValue({ success: true });
  });

  it('cria feedback novo mesmo se o closer respondeu "Remarcou" há menos de 24h', async () => {
    // A trava só considera respostas meeting_done — um "Remarcou" recente não bloqueia.
    const { inserts } = installFake({ confirmed: null, meetingStartsAt: new Date(Date.now() - 3600_000).toISOString() });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('sent');
    expect(inserts).toHaveLength(1);
  });

  it('pula quando o closer já confirmou "Realizada" a reunião atual', async () => {
    installFake({ confirmed: { id: 'done-1' }, meetingStartsAt: new Date(Date.now() - 3600_000).toISOString() });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.emailError).toBe('already_answered_recently');
    expect(sendPlatformEmail).not.toHaveBeenCalled();
  });

  it('reativa o link vencido e não respondido em vez de inserir outro', async () => {
    const { updates, inserts } = installFake({
      pending: { id: 'old-req', token: 'tok-old', expires_at: new Date(Date.now() - 86400_000).toISOString() },
      meetingStartsAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('sent');
    expect(inserts).toHaveLength(0);
    // 1) reativação volta a linha para "não enviado"; 2) o envio real carimba sent_at.
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ sent_at: null, reminder_count: 0, reminder_sent_at: null });
    expect(new Date(updates[0]!.expires_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(updates[1]!.sent_at).toEqual(expect.any(String));
    expect(sendPlatformEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('/feedback/tok-old') }),
    );
  });
});

describe('sendCloserFeedbackEmail — Ganho antes da reunião começar', () => {
  beforeEach(() => {
    resetMocks();
    sendPlatformEmail.mockReset();
    sendPlatformEmail.mockResolvedValue({ success: true });
  });

  it('cria o pedido sem sent_at, registra "agendado" na timeline e não envia nada', async () => {
    const meetingStartsAt = new Date(Date.now() + 2 * 86400_000).toISOString();
    const { inserts, interactions } = installFake({ meetingStartsAt });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('scheduled');
    expect(result.emailError).toBe('meeting_in_future');
    expect(result.scheduledFor).toBe(meetingStartsAt);
    expect(sendPlatformEmail).not.toHaveBeenCalled();

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ lead_id: 'lead-1', closer_id: 'closer-1', sent_at: null });
    // Validade provisória cobre reunião + 7 dias (o envio real recarimba).
    expect(new Date(inserts[0]!.expires_at as string).getTime()).toBe(new Date(meetingStartsAt).getTime() + 7 * 86400_000);

    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      channel: 'system',
      metadata: expect.objectContaining({ system_event: 'closer_feedback_scheduled', scheduled_for: meetingStartsAt }),
    });
    expect(String(interactions[0]!.message_content)).toContain('agendado para depois da reunião');
  });

  it('reenvio antes da reunião reaproveita o pedido agendado sem duplicar o aviso', async () => {
    const meetingStartsAt = new Date(Date.now() + 3600_000).toISOString();
    const { inserts, interactions } = installFake({
      pending: { id: 'sched-1', token: 'tok-sched', expires_at: new Date(Date.now() + 8 * 86400_000).toISOString(), sent_at: null },
      meetingStartsAt,
    });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('scheduled');
    expect(inserts).toHaveLength(0);
    expect(interactions).toHaveLength(0);
    expect(sendPlatformEmail).not.toHaveBeenCalled();
  });

  it('pedido agendado com a reunião já passada é enviado e recebe sent_at', async () => {
    const { updates } = installFake({
      pending: { id: 'sched-1', token: 'tok-sched', expires_at: new Date(Date.now() + 6 * 86400_000).toISOString(), sent_at: null },
      meetingStartsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('sent');
    expect(sendPlatformEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('/feedback/tok-sched') }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sent_at).toEqual(expect.any(String));
    expect(new Date(updates[0]!.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
  });

  it('link já entregue não é reenviado quando a reunião foi remarcada para o futuro', async () => {
    const { updates } = installFake({
      pending: { id: 'old-1', token: 'tok-old', expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(), sent_at: new Date().toISOString() },
      meetingStartsAt: new Date(Date.now() + 86400_000).toISOString(),
    });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('scheduled');
    expect(updates).toHaveLength(0);
    expect(sendPlatformEmail).not.toHaveBeenCalled();
  });

  it('dois canais falhando deixam a linha sem sent_at para o cron tentar de novo', async () => {
    sendPlatformEmail.mockResolvedValue({ success: false, error: 'resend_down' });
    const { updates } = installFake({ meetingStartsAt: new Date(Date.now() - 3600_000).toISOString() });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.email).toBe('failed');
    expect(updates).toHaveLength(0);
  });
});
