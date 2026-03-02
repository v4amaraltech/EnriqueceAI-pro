import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock service role client
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

import { GET } from './route';

function createChainMock(finalResult: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve, reject);
  return chain;
}

function makeParams(interactionId: string) {
  return { params: Promise.resolve({ interactionId }) };
}

describe('Track Open Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a 1x1 transparent GIF with correct headers', async () => {
    const selectChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(selectChain);

    const request = new Request('https://example.com/api/track/open/int-1');
    const response = await GET(request, makeParams('int-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(response.headers.get('Cache-Control')).toContain('no-store');

    const body = await response.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('should increment open_count in metadata', async () => {
    const selectChain = createChainMock({ data: { metadata: { subject: 'Hello' } } });
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      return callIndex === 1 ? selectChain : updateChain;
    });

    const request = new Request('https://example.com/api/track/open/int-1');
    await GET(request, makeParams('int-1'));

    expect(mockFrom).toHaveBeenCalledWith('interactions');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ subject: 'Hello', open_count: 1 }),
      }),
    );
  });

  it('should increment existing open_count', async () => {
    const selectChain = createChainMock({ data: { metadata: { open_count: 3 } } });
    const updateChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      return callIndex === 1 ? selectChain : updateChain;
    });

    const request = new Request('https://example.com/api/track/open/int-1');
    await GET(request, makeParams('int-1'));

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ open_count: 4 }),
      }),
    );
  });

  it('should still return GIF when interaction not found', async () => {
    const selectChain = createChainMock({ data: null });
    mockFrom.mockReturnValue(selectChain);

    const request = new Request('https://example.com/api/track/open/nonexistent');
    const response = await GET(request, makeParams('nonexistent'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/gif');
  });

  it('should still return GIF on Supabase error', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('DB connection failed');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const request = new Request('https://example.com/api/track/open/int-err');
    const response = await GET(request, makeParams('int-err'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[track/open]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
