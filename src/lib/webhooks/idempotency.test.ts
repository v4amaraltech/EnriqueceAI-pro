import { describe, expect, it, vi } from 'vitest';

import { isEventProcessed, markEventProcessed, markEventReceived } from './idempotency';

function createMockSupabase(selectResult: unknown = null, upsertResult: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: selectResult });
  chain.upsert = vi.fn().mockResolvedValue({ data: upsertResult, error: null });

  const from = vi.fn().mockReturnValue(chain);
  return { client: { from } as unknown as Parameters<typeof isEventProcessed>[0], from, chain };
}

describe('isEventProcessed', () => {
  it('should return false when event does not exist', async () => {
    const { client } = createMockSupabase(null);

    const result = await isEventProcessed(client, 'stripe', 'evt_123');

    expect(result).toBe(false);
  });

  it('should return true when event exists', async () => {
    const { client } = createMockSupabase({ id: 'some-uuid' });

    const result = await isEventProcessed(client, 'stripe', 'evt_123');

    expect(result).toBe(true);
  });

  it('should query webhook_events with correct provider and event_id', async () => {
    const { client, from, chain } = createMockSupabase(null);

    await isEventProcessed(client, 'whatsapp', 'msg_abc');

    expect(from).toHaveBeenCalledWith('webhook_events');
    expect(chain.select).toHaveBeenCalledWith('id');
    expect(chain.eq).toHaveBeenCalledWith('provider', 'whatsapp');
    expect(chain.eq).toHaveBeenCalledWith('event_id', 'msg_abc');
    expect(chain.maybeSingle).toHaveBeenCalled();
  });
});

describe('markEventProcessed', () => {
  it('should upsert into webhook_events with correct data', async () => {
    const { client, from, chain } = createMockSupabase();

    await markEventProcessed(client, 'stripe', 'evt_456', 'checkout.session.completed');

    expect(from).toHaveBeenCalledWith('webhook_events');
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        event_id: 'evt_456',
        event_type: 'checkout.session.completed',
      }),
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    );
  });

  it('should include payload when provided', async () => {
    const { client, chain } = createMockSupabase();
    const payload = { foo: 'bar' };

    await markEventProcessed(client, 'whatsapp', 'msg_789', 'message.text', payload);

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { foo: 'bar' } }),
      expect.any(Object),
    );
  });

  it('should set payload to null when not provided', async () => {
    const { client, chain } = createMockSupabase();

    await markEventProcessed(client, 'stripe', 'evt_000', 'invoice.paid');

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: null }),
      expect.any(Object),
    );
  });
});

describe('markEventReceived', () => {
  it('should upsert with status pending and retry_count 0', async () => {
    const { client, from, chain } = createMockSupabase();

    await markEventReceived(client, 'stripe', 'evt_recv_1', 'checkout.session.completed');

    expect(from).toHaveBeenCalledWith('webhook_events');
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        event_id: 'evt_recv_1',
        event_type: 'checkout.session.completed',
        status: 'pending',
        retry_count: 0,
        payload: null,
      }),
      { onConflict: 'provider,event_id', ignoreDuplicates: true },
    );
  });

  it('should include payload when provided', async () => {
    const { client, chain } = createMockSupabase();
    const payload = { session_id: 'cs_123' };

    await markEventReceived(client, 'stripe', 'evt_recv_2', 'checkout.session.completed', payload);

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { session_id: 'cs_123' } }),
      expect.any(Object),
    );
  });
});

describe('dedup flow', () => {
  it('should detect event as processed after marking it', async () => {
    // Simulates: first call returns null (not processed), then after mark, returns a record
    const { client, chain } = createMockSupabase(null);

    const before = await isEventProcessed(client, 'stripe', 'evt_dup');
    expect(before).toBe(false);

    await markEventProcessed(client, 'stripe', 'evt_dup', 'test.event');

    // Simulate DB state change
    (chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 'uuid' } });

    const after = await isEventProcessed(client, 'stripe', 'evt_dup');
    expect(after).toBe(true);
  });
});
