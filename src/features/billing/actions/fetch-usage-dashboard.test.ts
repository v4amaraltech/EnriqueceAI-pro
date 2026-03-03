import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as any;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

const mockCalculateUsageLimits = vi.fn().mockReturnValue({
  leads: { current: 1200, max: 5000, exceeded: false },
  aiPerDay: { current: 42, max: 100, exceeded: false, unlimited: false },
  whatsappPerMonth: { current: 350, max: 2000, exceeded: false },
  users: { current: 3, included: 5, additional: 0 },
});

vi.mock('../services/feature-flags', () => ({
  calculateUsageLimits: (...args: unknown[]) => mockCalculateUsageLimits(...args),
}));

import { fetchUsageDashboard } from './fetch-usage-dashboard';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockPlan = {
  id: 'plan-1',
  name: 'Pro',
  slug: 'pro',
  price_cents: 34900,
  max_leads: 5000,
  max_ai_per_day: 100,
  max_whatsapp_per_month: 2000,
  included_users: 5,
  additional_user_price_cents: 8900,
  features: { enrichment: 'lemit' as const, crm: true, calendar: true },
  active: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockSubscription = {
  id: 'sub-1',
  org_id: 'org-1',
  plan_id: 'plan-1',
  status: 'active' as const,
  current_period_start: '2025-01-01T00:00:00Z',
  current_period_end: '2025-02-01T00:00:00Z',
  stripe_subscription_id: 'stripe-sub-1',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const mockMember = { org_id: 'org-1' };

const mockAiUsage = {
  id: 'ai-1',
  org_id: 'org-1',
  usage_date: '2026-03-03',
  generation_count: 42,
  daily_limit: 100,
};

const mockWaCredits = {
  id: 'wa-1',
  org_id: 'org-1',
  plan_credits: 2000,
  used_credits: 350,
  overage_count: 0,
  period: '2026-03',
};

// ---------------------------------------------------------------------------
// Chain mock builder (same as fetch-billing.test.ts)
// ---------------------------------------------------------------------------

function makeChain(resolvedValue: unknown) {
  const terminal = vi.fn().mockResolvedValue(resolvedValue);

  const chain: Record<string, unknown> = {};

  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.contains = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.single = terminal;
  chain.maybeSingle = terminal;

  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(resolve, reject);

  return chain;
}

function setupFromSequence(responses: unknown[]) {
  let callIndex = 0;
  mockFrom.mockImplementation(() => {
    const value = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return makeChain(value);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchUsageDashboard', () => {
  beforeEach(() => {
    resetMocks();
    mockCalculateUsageLimits.mockClear();
  });

  it('returns UsageDashboardData with all data populated', async () => {
    // Call sequence (8 from() calls):
    // 1. organization_members → single() → member
    // 2. subscriptions → maybeSingle → subscription
    // 3. plans → single() → plan
    // Then Promise.all (5 parallel, but sequential from() calls):
    // 4. leads → (count) → { count: 1200 }
    // 5. ai_usage today → maybeSingle → aiUsage
    // 6. whatsapp_credits → maybeSingle → waCredits
    // 7. organization_members → (count) → { count: 3 }
    // 8. ai_usage history → (order) → data[]
    setupFromSequence([
      { data: mockMember },
      { data: mockSubscription },
      { data: mockPlan },
      { count: 1200 },
      { data: mockAiUsage },
      { data: mockWaCredits },
      { count: 3 },
      { data: [{ usage_date: '2026-03-01', generation_count: 10 }] },
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.plan).toEqual(mockPlan);
    expect(result.data.aiHistory).toHaveLength(30);
    expect(mockCalculateUsageLimits).toHaveBeenCalledWith(
      mockPlan,
      1200,  // currentLeads
      42,    // aiUsedToday
      350,   // waUsedThisMonth
      3,     // memberCount
    );
  });

  it('returns error when org member is not found', async () => {
    setupFromSequence([{ data: null }]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('Organização não encontrada');
  });

  it('returns error when subscription is not found', async () => {
    setupFromSequence([
      { data: mockMember },
      { data: null },
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('Assinatura não encontrada');
  });

  it('returns error when plan is not found', async () => {
    setupFromSequence([
      { data: mockMember },
      { data: mockSubscription },
      { data: null },
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('Plano não encontrado');
  });

  it('defaults to 0 when AI usage record is null', async () => {
    setupFromSequence([
      { data: mockMember },
      { data: mockSubscription },
      { data: mockPlan },
      { count: 500 },
      { data: null }, // no AI usage today
      { data: mockWaCredits },
      { count: 2 },
      { data: [] },
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(true);
    expect(mockCalculateUsageLimits).toHaveBeenCalledWith(
      mockPlan,
      500,   // currentLeads
      0,     // aiUsedToday defaults to 0
      350,   // waUsedThisMonth
      2,     // memberCount
    );
  });

  it('defaults to 0 when WhatsApp credits record is null', async () => {
    setupFromSequence([
      { data: mockMember },
      { data: mockSubscription },
      { data: mockPlan },
      { count: 500 },
      { data: mockAiUsage },
      { data: null }, // no WA credits
      { count: 2 },
      { data: [] },
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(true);
    expect(mockCalculateUsageLimits).toHaveBeenCalledWith(
      mockPlan,
      500,
      42,
      0,    // waUsedThisMonth defaults to 0
      2,
    );
  });

  it('defaults member count to 1 when null', async () => {
    setupFromSequence([
      { data: mockMember },
      { data: mockSubscription },
      { data: mockPlan },
      { count: 100 },
      { data: null },
      { data: null },
      { count: null }, // member count null
      { data: [] },
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(true);
    expect(mockCalculateUsageLimits).toHaveBeenCalledWith(
      mockPlan,
      100,
      0,
      0,
      1,    // memberCount defaults to 1
    );
  });

  it('fills 30 days of AI history with zeros for missing days', async () => {
    setupFromSequence([
      { data: mockMember },
      { data: mockSubscription },
      { data: mockPlan },
      { count: 0 },
      { data: null },
      { data: null },
      { count: 1 },
      { data: [] }, // no AI history rows at all
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.aiHistory).toHaveLength(30);
    expect(result.data.aiHistory.every((d) => d.count === 0)).toBe(true);
    // First entry should be 29 days ago, last entry should be today
    const today = new Date().toISOString().split('T')[0]!;
    expect(result.data.aiHistory[29]!.date).toBe(today);
  });

  it('merges AI history data with zero-filled days', async () => {
    const today = new Date().toISOString().split('T')[0]!;

    setupFromSequence([
      { data: mockMember },
      { data: mockSubscription },
      { data: mockPlan },
      { count: 0 },
      { data: null },
      { data: null },
      { count: 1 },
      { data: [{ usage_date: today, generation_count: 25 }] },
    ]);

    const result = await fetchUsageDashboard();

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Today's entry should have the actual count
    const todayEntry = result.data.aiHistory.find((d) => d.date === today);
    expect(todayEntry?.count).toBe(25);

    // Other entries should be 0
    const nonTodayEntries = result.data.aiHistory.filter((d) => d.date !== today);
    expect(nonTodayEntries.every((d) => d.count === 0)).toBe(true);
  });
});
