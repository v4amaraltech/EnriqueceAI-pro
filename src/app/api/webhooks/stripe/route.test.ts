import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockFrom, mockConstructEvent, mockRetrieve, mockAfter } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockConstructEvent: vi.fn(),
  mockRetrieve: vi.fn(),
  mockAfter: vi.fn((cb: () => unknown) => cb()),
}));

const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockRetrieve },
  },
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mockAfter };
});

vi.mock('@/lib/webhooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/webhooks')>();
  return {
    ...actual,
    isEventProcessed: vi.fn().mockResolvedValue(false),
    markEventReceived: vi.fn().mockResolvedValue(undefined),
    markEventProcessed: vi.fn().mockResolvedValue(undefined),
    processWithRetry: vi.fn().mockImplementation(async (opts: { process: () => Promise<void> }) => {
      await opts.process();
    }),
  };
});

vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_secret');

import { isEventProcessed, markEventReceived, processWithRetry } from '@/lib/webhooks';

import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createChainMock(finalResult: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve, reject);
  return chain;
}

function makeRequest(body: string, signature?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature) {
    headers['stripe-signature'] = signature;
  }
  return new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body,
  });
}

function makeStripeEvent(type: string, data: unknown, id = 'evt_test_123') {
  return { id, type, data: { object: data } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stripe Webhook POST — Signature Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject request without stripe-signature header', async () => {
    const request = makeRequest('{}');

    const response = await POST(request);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('Missing signature');
  });

  it('should reject request with invalid signature', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const request = makeRequest('{}', 'sig_invalid');

    const response = await POST(request);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('Invalid signature');
  });
});

describe('Stripe Webhook POST — Background Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call markEventReceived and schedule background processing', async () => {
    const session = {
      metadata: { org_id: 'org-1', plan_id: 'plan-pro' },
      subscription: 'sub_123',
    };

    const stripeSub = {
      created: 1700000000,
      items: {
        data: [
          {
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    mockConstructEvent.mockReturnValue(makeStripeEvent('checkout.session.completed', session));
    mockRetrieve.mockResolvedValue(stripeSub);

    const updateChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(updateChain);

    const request = makeRequest('{}', 'sig_valid');
    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.received).toBe(true);

    // Should mark event as received
    expect(markEventReceived).toHaveBeenCalledWith(
      mockSupabase,
      'stripe',
      'evt_test_123',
      'checkout.session.completed',
    );

    // Should schedule background processing via after()
    expect(mockAfter).toHaveBeenCalled();

    // processWithRetry should have been called (via after mock executing sync)
    expect(processWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: mockSupabase,
        provider: 'stripe',
        eventId: 'evt_test_123',
        eventType: 'checkout.session.completed',
      }),
    );
  });
});

describe('Stripe Webhook POST — checkout.session.completed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should activate subscription on checkout completion', async () => {
    const session = {
      metadata: { org_id: 'org-1', plan_id: 'plan-pro' },
      subscription: 'sub_123',
    };

    const stripeSub = {
      created: 1700000000,
      items: {
        data: [
          {
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    mockConstructEvent.mockReturnValue(makeStripeEvent('checkout.session.completed', session));
    mockRetrieve.mockResolvedValue(stripeSub);

    const updateChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(updateChain);

    const request = makeRequest('{}', 'sig_valid');
    const response = await POST(request);

    expect(response.status).toBe(200);

    // Should update subscriptions table
    expect(mockFrom).toHaveBeenCalledWith('subscriptions');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: 'plan-pro',
        status: 'active',
        stripe_subscription_id: 'sub_123',
      }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith('org_id', 'org-1');

    // Should retrieve subscription from Stripe
    expect(mockRetrieve).toHaveBeenCalledWith('sub_123');
  });
});

describe('Stripe Webhook POST — customer.subscription.updated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should map Stripe status to DB and update subscription', async () => {
    const sub = {
      customer: 'cus_123',
      status: 'past_due',
      created: 1700000000,
      items: {
        data: [
          {
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        ],
      },
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('customer.subscription.updated', sub),
    );

    // First call: organizations select → returns org
    const orgChain = createChainMock({ data: { id: 'org-1' } });
    // Second call: subscriptions update
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return orgChain;
      return updateChain;
    });

    const request = makeRequest('{}', 'sig_valid');
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith('organizations');
    expect(mockFrom).toHaveBeenCalledWith('subscriptions');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' }),
    );
  });
});

describe('Stripe Webhook POST — customer.subscription.deleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mark subscription as canceled', async () => {
    const sub = {
      customer: 'cus_456',
      status: 'canceled',
      created: 1700000000,
      items: { data: [] },
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('customer.subscription.deleted', sub),
    );

    const orgChain = createChainMock({ data: { id: 'org-2' } });
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return orgChain;
      return updateChain;
    });

    const request = makeRequest('{}', 'sig_valid');
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith('organizations');
    expect(mockFrom).toHaveBeenCalledWith('subscriptions');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'canceled',
        stripe_subscription_id: null,
      }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith('org_id', 'org-2');
  });
});

describe('Stripe Webhook POST — invoice.payment_failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mark subscription as past_due', async () => {
    const invoice = { customer: 'cus_789' };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('invoice.payment_failed', invoice),
    );

    const orgChain = createChainMock({ data: { id: 'org-3' } });
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return orgChain;
      return updateChain;
    });

    const request = makeRequest('{}', 'sig_valid');
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith('subscriptions');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith('org_id', 'org-3');
  });
});

describe('Stripe Webhook POST — Idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip already-processed event and return 200', async () => {
    vi.mocked(isEventProcessed).mockResolvedValueOnce(true);

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', {}, 'evt_duplicate'),
    );

    const request = makeRequest('{}', 'sig_valid');
    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.received).toBe(true);

    // Should NOT call markEventReceived or processWithRetry
    expect(markEventReceived).not.toHaveBeenCalled();
    expect(processWithRetry).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('Stripe Webhook POST — Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should still return 200 when handler throws (error handled by processWithRetry)', async () => {
    const session = {
      metadata: { org_id: 'org-err', plan_id: 'plan-err' },
      subscription: 'sub_err',
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', session),
    );

    // processWithRetry handles errors internally, so POST always returns 200
    vi.mocked(processWithRetry).mockResolvedValue(undefined);

    const request = makeRequest('{}', 'sig_valid');
    const response = await POST(request);

    // With after() pattern, response is always 200 — errors handled by DLQ
    expect(response.status).toBe(200);
  });
});
