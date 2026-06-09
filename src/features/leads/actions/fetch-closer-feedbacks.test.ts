import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

const getAuthOrgIdResult = vi.fn();
vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: () => getAuthOrgIdResult(),
}));

import { fetchCloserFeedbacks } from './fetch-closer-feedbacks';

const LEAD_INOBLOCO = 'aaaaaaaa-0000-0000-0000-000000000001';
const LEAD_BRASCALD = 'aaaaaaaa-0000-0000-0000-000000000002';
const LEAD_NATURAL = 'aaaaaaaa-0000-0000-0000-000000000003';

const CLOSER_PEDRO = 'cccccccc-0000-0000-0000-000000000001';
const CLOSER_JHONATA = 'cccccccc-0000-0000-0000-000000000002';

function builderResolving(data: unknown) {
  const b = createQueryBuilder();
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error: null, count: null }).then(resolve, reject);
  return b;
}

describe('fetchCloserFeedbacks — superseded request filtering', () => {
  beforeEach(() => {
    resetMocks();
    getAuthOrgIdResult.mockReset();
    getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', supabase: mockSupabase },
    });
  });

  it('hides a request killed by closer reassignment but keeps the replacement and legit rows', async () => {
    const rows = [
      // INOBLOCO: killed by reassignment — never answered, ~2h validity window,
      // superseded by a newer request for the same lead → must be hidden.
      {
        id: 'req-pedro',
        result: null,
        rating: null,
        comment: null,
        sent_at: '2026-06-01T21:17:48Z',
        responded_at: null,
        expires_at: '2026-06-01T23:21:57Z',
        lead_id: LEAD_INOBLOCO,
        closer_id: CLOSER_PEDRO,
      },
      // INOBLOCO: the real replacement — answered → kept.
      {
        id: 'req-jhonata',
        result: 'meeting_done',
        rating: 5,
        comment: null,
        sent_at: '2026-06-01T23:21:58Z',
        responded_at: '2026-06-01T23:27:52Z',
        expires_at: '2026-06-08T23:21:58Z',
        lead_id: LEAD_INOBLOCO,
        closer_id: CLOSER_JHONATA,
      },
      // BRASCALD: two legitimate meetings, both answered → both kept.
      {
        id: 'req-bras-1',
        result: 'no_show',
        rating: null,
        comment: null,
        sent_at: '2026-04-16T18:15:37Z',
        responded_at: '2026-04-17T10:00:00Z',
        expires_at: '2026-05-13T18:15:37Z',
        lead_id: LEAD_BRASCALD,
        closer_id: CLOSER_JHONATA,
      },
      {
        id: 'req-bras-2',
        result: 'no_show',
        rating: null,
        comment: null,
        sent_at: '2026-05-26T19:04:40Z',
        responded_at: '2026-05-27T09:00:00Z',
        expires_at: '2026-06-02T19:04:40Z',
        lead_id: LEAD_BRASCALD,
        closer_id: CLOSER_JHONATA,
      },
      // NATURAL expiry — unanswered but ran its full 7-day window and has no
      // newer sibling → NOT superseded, must stay visible.
      {
        id: 'req-natural',
        result: null,
        rating: null,
        comment: null,
        sent_at: '2026-05-01T00:00:00Z',
        responded_at: null,
        expires_at: '2026-05-08T00:00:00Z',
        lead_id: LEAD_NATURAL,
        closer_id: CLOSER_JHONATA,
      },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'closer_feedback_requests') return builderResolving(rows);
      if (table === 'leads') {
        return builderResolving([
          { id: LEAD_INOBLOCO, nome_fantasia: 'Inobloco Ltda', razao_social: null },
          { id: LEAD_BRASCALD, nome_fantasia: 'Brascald', razao_social: null },
          { id: LEAD_NATURAL, nome_fantasia: 'Lead Natural', razao_social: null },
        ]);
      }
      if (table === 'closers') {
        return builderResolving([
          { id: CLOSER_PEDRO, name: 'Pedro Neves', email: 'pedro@x.com' },
          { id: CLOSER_JHONATA, name: 'Jhonata Banqueri', email: 'jhonata@x.com' },
        ]);
      }
      return createQueryBuilder();
    });

    const result = await fetchCloserFeedbacks();

    expect(result.success).toBe(true);
    if (!result.success) return;

    const ids = result.data.map((r) => r.id);
    expect(ids).not.toContain('req-pedro'); // superseded → hidden
    expect(ids).toEqual(
      expect.arrayContaining(['req-jhonata', 'req-bras-1', 'req-bras-2', 'req-natural']),
    );
    expect(result.data).toHaveLength(4);
    // Pedro's closer is no longer referenced in the visible set.
    expect(result.data.some((r) => r.closer_name === 'Pedro Neves')).toBe(false);
  });
});
