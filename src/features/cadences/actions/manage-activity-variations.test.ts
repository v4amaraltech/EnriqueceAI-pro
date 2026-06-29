import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentChain: Record<string, ReturnType<typeof vi.fn>>;

vi.mock('@/lib/supabase/from', () => ({
  from: vi.fn(() => currentChain),
}));

vi.mock('@/lib/auth/get-org-id', () => ({
  getAuthOrgIdResult: vi.fn(() =>
    Promise.resolve({ success: true, data: { orgId: 'org-1', userId: 'user-1', supabase: {} } }),
  ),
}));

import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import {
  createActivityVariation,
  deleteActivityVariation,
  fetchActivityVariations,
  renameActivityVariation,
} from './manage-activity-variations';

function makeChain(result: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  // Thenable so `await from(...).select().eq().order()` resolves too.
  (chain as Record<string, unknown>).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

const row = {
  id: '11111111-1111-1111-1111-111111111111',
  org_id: 'org-1',
  channel: 'phone',
  label: 'Ligação 2',
  call_provider: null,
  sort_order: 0,
  created_at: '',
  updated_at: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthOrgIdResult).mockResolvedValue({
    success: true,
    data: { orgId: 'org-1', userId: 'user-1', supabase: {} as never },
  });
});

describe('fetchActivityVariations', () => {
  it('returns the org variations', async () => {
    currentChain = makeChain({ data: [row], error: null });
    const res = await fetchActivityVariations();
    expect(res).toEqual({ success: true, data: [row] });
  });

  it('propagates auth failure', async () => {
    vi.mocked(getAuthOrgIdResult).mockResolvedValue({ success: false, error: 'Organização não encontrada' });
    const res = await fetchActivityVariations();
    expect(res).toEqual({ success: false, error: 'Organização não encontrada' });
  });
});

describe('createActivityVariation', () => {
  it('inserts and returns the new row', async () => {
    currentChain = makeChain({ data: row, error: null });
    const res = await createActivityVariation({ channel: 'phone', label: 'Ligação 2' });
    expect(res).toEqual({ success: true, data: row });
    expect(currentChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'org-1', channel: 'phone', label: 'Ligação 2' }),
    );
  });

  it('rejects an invalid channel', async () => {
    const res = await createActivityVariation({ channel: 'sms', label: 'x' });
    expect(res.success).toBe(false);
  });

  it('rejects an empty label', async () => {
    const res = await createActivityVariation({ channel: 'phone', label: '   ' });
    expect(res.success).toBe(false);
  });
});

describe('renameActivityVariation', () => {
  it('updates the label', async () => {
    currentChain = makeChain({ data: { ...row, label: 'WhatsApp Ligação' }, error: null });
    const res = await renameActivityVariation({ id: row.id, label: 'WhatsApp Ligação' });
    expect(res.success).toBe(true);
    expect(currentChain.update).toHaveBeenCalledWith(expect.objectContaining({ label: 'WhatsApp Ligação' }));
  });

  it('rejects a non-uuid id', async () => {
    const res = await renameActivityVariation({ id: 'temp-1', label: 'x' });
    expect(res.success).toBe(false);
  });
});

describe('deleteActivityVariation', () => {
  it('deletes by id and org', async () => {
    currentChain = makeChain({ data: null, error: null });
    const res = await deleteActivityVariation(row.id);
    expect(res).toEqual({ success: true, data: { id: row.id } });
    expect(currentChain.delete).toHaveBeenCalled();
  });

  it('rejects a non-uuid id', async () => {
    const res = await deleteActivityVariation('nope');
    expect(res.success).toBe(false);
  });
});
