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
  pending?: { id: string; token: string; expires_at: string } | null;
  confirmed?: { id: string } | null;
  meetingStartsAt?: string | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  mockFrom.mockImplementation((table: string) => {
    const b = createQueryBuilder();
    const eqs: Array<[string, unknown]> = [];
    b.eq = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val]);
      return b;
    });
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
          data: isConfirmedLookup ? (opts.confirmed ?? null) : (opts.pending ?? null),
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
  return { updates, inserts };
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
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ reminder_count: 0, reminder_sent_at: null });
    expect(new Date(updates[0]!.expires_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(sendPlatformEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('/feedback/tok-old') }),
    );
  });

  it('não cria feedback antes da nova reunião acontecer', async () => {
    const { inserts } = installFake({ meetingStartsAt: new Date(Date.now() + 2 * 86400_000).toISOString() });

    const result = await sendCloserFeedbackEmail(BASE);

    expect(result.emailError).toBe('meeting_in_future');
    expect(inserts).toHaveLength(0);
  });
});
