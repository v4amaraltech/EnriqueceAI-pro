import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock service role client
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, limit: 100 }),
}));

import { GET } from './route';

function createChainMock(finalResult: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve, reject);
  return chain;
}

/** Interaction row shape the route validates against (M1): message_content must
 *  contain the target URL for the redirect to be allowed. */
function interactionData(messageContent: string, metadata: Record<string, unknown> = {}) {
  return {
    data: {
      metadata,
      message_content: messageContent,
      org_id: 'org-1',
      lead_id: 'lead-1',
      cadence_id: 'cad-1',
      step_id: 'step-1',
    },
  };
}

function makeParams(interactionId: string) {
  return { params: Promise.resolve({ interactionId }) };
}

describe('Track Click Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should redirect to target URL with 302 when the url is in the email body', async () => {
    const selectChain = createChainMock(
      interactionData('<a href="https://acme.com/pricing">Ver preços</a>'),
    );
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      return callIndex === 1 ? selectChain : updateChain;
    });

    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=https://acme.com/pricing',
    );
    const response = await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://acme.com/pricing');
  });

  it('should record click in metadata', async () => {
    const selectChain = createChainMock(
      interactionData('Veja em https://acme.com agora', { subject: 'Hello' }),
    );
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      return callIndex === 1 ? selectChain : updateChain;
    });

    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=https://acme.com',
    );
    await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          subject: 'Hello',
          clicks: expect.arrayContaining([
            expect.objectContaining({ url: 'https://acme.com/', clicked_at: expect.any(String) }),
          ]),
        }),
      }),
    );
  });

  it('should append to existing clicks array', async () => {
    const existingClicks = [{ url: 'https://old.com', clicked_at: '2026-01-01T00:00:00.000Z' }];
    const selectChain = createChainMock(
      interactionData('Link: https://new.com', { clicks: existingClicks }),
    );
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      return callIndex === 1 ? selectChain : updateChain;
    });

    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=https://new.com',
    );
    await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          clicks: expect.arrayContaining([
            expect.objectContaining({ url: 'https://old.com' }),
            expect.objectContaining({ url: 'https://new.com/' }),
          ]),
        }),
      }),
    );
  });

  // M1: open-redirect protection — only follow URLs that were in the sent email.
  it('should return 400 when the url is NOT in the email body (open-redirect block)', async () => {
    const selectChain = createChainMock(
      interactionData('<a href="https://acme.com/pricing">Ver preços</a>'),
    );
    mockFrom.mockReturnValue(selectChain);

    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=https://phishing.example/steal',
    );
    const response = await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('should return 400 when the interaction does not exist', async () => {
    mockFrom.mockReturnValue(createChainMock({ data: null }));

    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=https://acme.com',
    );
    const response = await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(response.status).toBe(400);
  });

  it('should return 400 when url param is missing', async () => {
    const request = new Request('https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000');
    const response = await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Missing url parameter');
  });

  it('should return 400 for invalid URL', async () => {
    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=not-a-url',
    );
    const response = await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid URL');
  });

  it('should return 400 for non-http protocol', async () => {
    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=javascript:alert(1)',
    );
    const response = await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(response.status).toBe(400);
  });

  // M1: fail closed — if validation can't run (DB error), do NOT redirect.
  it('should NOT redirect on Supabase error (fail closed)', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('DB connection failed');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const request = new Request(
      'https://example.com/api/track/click/550e8400-e29b-41d4-a716-446655440000?url=https://acme.com',
    );
    const response = await GET(request, makeParams('550e8400-e29b-41d4-a716-446655440000'));

    expect(response.status).toBe(502);
    expect(response.headers.get('Location')).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[track/click]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
