import crypto from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock service role client
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

// Mock next/server after() to execute callback synchronously
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn((cb: () => unknown) => cb()) };
});

// Mock webhook utilities — keep real verifyHmacSignature and logger, stub idempotency + retry
vi.mock('@/features/cadences/services/webhook-dispatch.service', () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/webhooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/webhooks')>();
  return {
    ...actual,
    isEventProcessed: vi.fn().mockResolvedValue(false),
    markEventProcessed: vi.fn().mockResolvedValue(undefined),
    markEventReceived: vi.fn().mockResolvedValue(undefined),
    processWithRetry: vi.fn().mockImplementation(async (opts: { process: () => Promise<void> }) => {
      await opts.process();
    }),
  };
});

import { GET, POST } from './route';

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

function signPayload(payload: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function makeRequest(body: unknown, headers: Record<string, string> = {}, secret?: string): Request {
  const bodyStr = JSON.stringify(body);
  if (secret) {
    headers['x-hub-signature-256'] = signPayload(bodyStr, secret);
  }
  return new Request('https://example.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyStr,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhatsApp Webhook GET', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, WHATSAPP_VERIFY_TOKEN: 'my-verify-token' };
  });

  it('should return challenge on valid subscription verification', async () => {
    const url = 'https://example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=test-challenge-123';
    const request = new Request(url);

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('test-challenge-123');
  });

  it('should return 403 on invalid token', async () => {
    const url = 'https://example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test';
    const request = new Request(url);

    const response = await GET(request);

    expect(response.status).toBe(403);
  });
});

describe('WhatsApp Webhook POST — Signature Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, WHATSAPP_APP_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should reject request without signature when secret is set', async () => {
    const request = makeRequest({ object: 'whatsapp_business_account' });
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it('should reject request with invalid signature', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account' });
    const request = new Request('https://example.com/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid',
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('should accept request with valid signature', async () => {
    const payload = JSON.stringify({ object: 'other' });
    const signature = signPayload(payload, 'test-secret');

    const request = new Request('https://example.com/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body: payload,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});

describe('WhatsApp Webhook POST — Status Updates', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, WHATSAPP_APP_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should update interaction status on delivery update', async () => {
    const updateChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(updateChain);

    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.123',
              status: 'delivered',
              timestamp: '1234567890',
            }],
          },
        }],
      }],
    };

    const response = await POST(makeRequest(body, {}, 'test-secret'));
    // Flush floating promises from after() background processing
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith('interactions');
  });
});

describe('WhatsApp Webhook POST — Reply Detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, WHATSAPP_APP_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should detect reply and mark enrollment as replied', async () => {
    // leads query
    const leadsChain = createChainMock({ data: { id: 'lead-1', org_id: 'org-1' } });
    // enrollment query
    const enrollmentChain = createChainMock({
      data: { id: 'enr-1', cadence_id: 'cad-1', current_step: 1 },
    });
    // step query
    const stepChain = createChainMock({ data: { id: 'step-1' } });
    // insert interaction
    const insertChain = createChainMock({ data: null });
    // update enrollment
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return leadsChain;
      if (callIndex === 2) return enrollmentChain;
      if (callIndex === 3) return stepChain;
      if (callIndex === 4) return insertChain;
      if (callIndex === 5) return updateChain;
      return createChainMock({ data: null });
    });

    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '5511999887766',
              id: 'wamid.reply-1',
              type: 'text',
              text: { body: 'Tenho interesse!' },
              timestamp: '1234567890',
            }],
          },
        }],
      }],
    };

    const response = await POST(makeRequest(body, {}, 'test-secret'));
    // Flush floating promises from after() background processing
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(200);
    // Should have queried leads, enrollments, steps, then inserted interaction and updated enrollment
    expect(mockFrom).toHaveBeenCalledWith('leads');
    expect(mockFrom).toHaveBeenCalledWith('cadence_enrollments');
    expect(mockFrom).toHaveBeenCalledWith('interactions');
  });

  it('should log warning when no lead found for phone', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const leadsChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(leadsChain);

    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '5511000000000',
              id: 'wamid.unknown',
              type: 'text',
              text: { body: 'Oi' },
              timestamp: '1234567890',
            }],
          },
        }],
      }],
    };

    const response = await POST(makeRequest(body, {}, 'test-secret'));
    // Flush floating promises from after() background processing
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No lead found'),
    );
    consoleSpy.mockRestore();
  });
});
