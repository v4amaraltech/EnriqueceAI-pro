import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processWithRetry } from './process-with-retry';

function createMockSupabase() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  // Make chain thenable so await resolves
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);

  const from = vi.fn().mockReturnValue(chain);
  return { client: { from } as unknown as Parameters<typeof processWithRetry>[0]['supabase'], from, chain };
}

describe('processWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should mark as processed on first attempt success', async () => {
    const { client, chain } = createMockSupabase();
    const process = vi.fn().mockResolvedValue(undefined);

    await processWithRetry({
      supabase: client,
      provider: 'stripe',
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      process,
    });

    expect(process).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processed', retry_count: 0 }),
    );
  });

  it('should retry and succeed on second attempt', async () => {
    const { client, chain } = createMockSupabase();
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce(undefined);

    const promise = processWithRetry({
      supabase: client,
      provider: 'stripe',
      eventId: 'evt_2',
      eventType: 'test.event',
      process,
    });

    // Advance past the 1s backoff delay
    await vi.advanceTimersByTimeAsync(1500);
    await promise;

    expect(process).toHaveBeenCalledTimes(2);

    // First call: mark as failed with retry_count=1
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', retry_count: 1, last_error: 'Temporary failure' }),
    );
    // Second call: mark as processed with retry_count=1
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processed', retry_count: 1 }),
    );
  });

  it('should move to dead_letter after 3 failures', async () => {
    const { client, chain } = createMockSupabase();
    const process = vi.fn().mockRejectedValue(new Error('Persistent failure'));

    const promise = processWithRetry({
      supabase: client,
      provider: 'api4com',
      eventId: 'evt_3',
      eventType: 'channel-hangup',
      process,
    });

    // Advance past all backoff delays (1s + 4s)
    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    expect(process).toHaveBeenCalledTimes(3);

    // Final update should be dead_letter
    expect(chain.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'dead_letter',
        retry_count: 3,
        last_error: 'Persistent failure',
      }),
    );
  });

  it('should mark status as failed between retries', async () => {
    const { client, chain } = createMockSupabase();
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockRejectedValueOnce(new Error('Fail 3'));

    const promise = processWithRetry({
      supabase: client,
      provider: 'whatsapp',
      eventId: 'evt_4',
      eventType: 'status.failed',
      process,
    });

    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    const updateCalls = (chain.update as ReturnType<typeof vi.fn>).mock.calls;

    // First failure: status='failed', retry_count=1
    expect(updateCalls[0]?.[0]).toEqual(
      expect.objectContaining({ status: 'failed', retry_count: 1 }),
    );
    // Second failure: status='failed', retry_count=2
    expect(updateCalls[1]?.[0]).toEqual(
      expect.objectContaining({ status: 'failed', retry_count: 2 }),
    );
    // Third failure: status='dead_letter', retry_count=3
    expect(updateCalls[2]?.[0]).toEqual(
      expect.objectContaining({ status: 'dead_letter', retry_count: 3 }),
    );
  });

  it('should respect custom maxRetries', async () => {
    const { client } = createMockSupabase();
    const process = vi.fn().mockRejectedValue(new Error('Always fails'));

    const promise = processWithRetry({
      supabase: client,
      provider: 'stripe',
      eventId: 'evt_5',
      eventType: 'test.event',
      process,
      maxRetries: 2,
    });

    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(process).toHaveBeenCalledTimes(2);
  });

  it('should stringify non-Error thrown values', async () => {
    const { client, chain } = createMockSupabase();
    const process = vi.fn().mockRejectedValue('string error');

    const promise = processWithRetry({
      supabase: client,
      provider: 'stripe',
      eventId: 'evt_6',
      eventType: 'test.event',
      process,
      maxRetries: 1,
    });

    await promise;

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_error: 'string error' }),
    );
  });
});
