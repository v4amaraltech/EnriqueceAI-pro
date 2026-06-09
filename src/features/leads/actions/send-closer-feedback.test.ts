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

  it('skips creating a request when the closer already answered this lead within 24h', async () => {
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
