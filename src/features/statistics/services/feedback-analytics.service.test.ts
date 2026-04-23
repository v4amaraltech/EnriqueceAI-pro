import { describe, expect, it, vi } from 'vitest';

import { fetchFeedbackAnalyticsData } from './feedback-analytics.service';

function createMockSupabase(feedbacks: unknown[] = [], closers: unknown[] = [], leads: unknown[] = []) {
  const chains: Record<string, Record<string, unknown>> = {};

  function buildChain(tableName: string, returnData: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.lte = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    // Terminal — resolve to data
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: returnData });
    chains[tableName] = chain;
    return chain;
  }

  const tableMap: Record<string, unknown[]> = {
    closer_feedback_requests: feedbacks,
    closers: closers,
    leads: leads,
  };

  const from = vi.fn((table: string) => buildChain(table, tableMap[table] ?? []));

  return { client: { from } as unknown as Parameters<typeof fetchFeedbackAnalyticsData>[0], from, chains };
}

const NOW = new Date('2026-04-23T12:00:00Z');

describe('fetchFeedbackAnalyticsData', () => {
  it('returns empty data when no feedbacks', async () => {
    const { client } = createMockSupabase();
    const result = await fetchFeedbackAnalyticsData(client, 'org-1', '2026-04-01', '2026-04-23');

    expect(result.kpis.totalSent).toBe(0);
    expect(result.kpis.totalResponded).toBe(0);
    expect(result.kpis.responseRate).toBe(0);
    expect(result.kpis.averageRating).toBeNull();
    expect(result.feedbacks).toHaveLength(0);
    expect(result.closerRanking).toHaveLength(0);
  });

  it('calculates KPIs correctly', async () => {
    const feedbacks = [
      { id: '1', lead_id: 'l1', closer_id: 'c1', result: 'meeting_done', rating: 4, comment: 'Bom', sent_at: '2026-04-10T10:00:00Z', responded_at: '2026-04-10T14:00:00Z', expires_at: null },
      { id: '2', lead_id: 'l2', closer_id: 'c1', result: 'meeting_done', rating: 5, comment: null, sent_at: '2026-04-11T10:00:00Z', responded_at: '2026-04-11T12:00:00Z', expires_at: null },
      { id: '3', lead_id: 'l3', closer_id: 'c1', result: null, rating: null, comment: null, sent_at: '2026-04-12T10:00:00Z', responded_at: null, expires_at: '2026-04-20T00:00:00Z' },
    ];
    const closers = [{ id: 'c1', name: 'Jhonata' }];
    const leads = [
      { id: 'l1', nome_fantasia: 'Lead A', razao_social: null, first_name: null, last_name: null },
      { id: 'l2', nome_fantasia: 'Lead B', razao_social: null, first_name: null, last_name: null },
      { id: 'l3', nome_fantasia: 'Lead C', razao_social: null, first_name: null, last_name: null },
    ];

    const { client } = createMockSupabase(feedbacks, closers, leads);
    const result = await fetchFeedbackAnalyticsData(client, 'org-1', '2026-04-01', '2026-04-23');

    expect(result.kpis.totalSent).toBe(3);
    expect(result.kpis.totalResponded).toBe(2);
    expect(result.kpis.responseRate).toBe(66.7); // 2/3
    expect(result.kpis.averageRating).toBe(4.5); // (4+5)/2
    expect(result.kpis.averageResponseTimeHours).toBe(3); // (4h + 2h) / 2
    expect(result.kpis.pendingCount).toBe(0); // expired, not pending
  });

  it('identifies expired feedbacks', async () => {
    const feedbacks = [
      { id: '1', lead_id: 'l1', closer_id: 'c1', result: null, rating: null, comment: null, sent_at: '2026-04-01T10:00:00Z', responded_at: null, expires_at: '2026-04-10T00:00:00Z' },
    ];
    const { client } = createMockSupabase(feedbacks, [{ id: 'c1', name: 'Closer' }], [{ id: 'l1', nome_fantasia: 'Lead', razao_social: null, first_name: null, last_name: null }]);
    const result = await fetchFeedbackAnalyticsData(client, 'org-1', '2026-04-01', '2026-04-23');

    expect(result.feedbacks[0]?.status).toBe('expired');
  });

  it('builds closer ranking sorted by total received', async () => {
    const feedbacks = [
      { id: '1', lead_id: 'l1', closer_id: 'c1', result: 'meeting_done', rating: 5, comment: null, sent_at: '2026-04-10T10:00:00Z', responded_at: '2026-04-10T14:00:00Z', expires_at: null },
      { id: '2', lead_id: 'l2', closer_id: 'c1', result: 'meeting_done', rating: 3, comment: null, sent_at: '2026-04-11T10:00:00Z', responded_at: '2026-04-11T12:00:00Z', expires_at: null },
      { id: '3', lead_id: 'l3', closer_id: 'c2', result: 'meeting_done', rating: 4, comment: null, sent_at: '2026-04-12T10:00:00Z', responded_at: '2026-04-12T11:00:00Z', expires_at: null },
    ];
    const closers = [{ id: 'c1', name: 'Jhonata' }, { id: 'c2', name: 'Vinicius' }];
    const leads = [
      { id: 'l1', nome_fantasia: 'A', razao_social: null, first_name: null, last_name: null },
      { id: 'l2', nome_fantasia: 'B', razao_social: null, first_name: null, last_name: null },
      { id: 'l3', nome_fantasia: 'C', razao_social: null, first_name: null, last_name: null },
    ];

    const { client } = createMockSupabase(feedbacks, closers, leads);
    const result = await fetchFeedbackAnalyticsData(client, 'org-1', '2026-04-01', '2026-04-23');

    expect(result.closerRanking).toHaveLength(2);
    expect(result.closerRanking[0]?.closerName).toBe('Jhonata');
    expect(result.closerRanking[0]?.totalReceived).toBe(2);
    expect(result.closerRanking[0]?.averageRating).toBe(4); // (5+3)/2
    expect(result.closerRanking[1]?.closerName).toBe('Vinicius');
    expect(result.closerRanking[1]?.totalReceived).toBe(1);
  });

  it('resolves lead names with fallback', async () => {
    const feedbacks = [
      { id: '1', lead_id: 'l1', closer_id: 'c1', result: null, rating: null, comment: null, sent_at: '2026-04-10T10:00:00Z', responded_at: null, expires_at: null },
    ];
    const leads = [{ id: 'l1', nome_fantasia: null, razao_social: null, first_name: 'João', last_name: 'Silva' }];

    const { client } = createMockSupabase(feedbacks, [{ id: 'c1', name: 'Closer' }], leads);
    const result = await fetchFeedbackAnalyticsData(client, 'org-1', '2026-04-01', '2026-04-23');

    expect(result.feedbacks[0]?.leadName).toBe('João Silva');
  });
});
