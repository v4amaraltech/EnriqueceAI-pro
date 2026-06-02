import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryBuilder, mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';

const mockFrom = mockSupabaseFrom as unknown as ReturnType<typeof vi.fn>;

const getManagerOrgId = vi.fn();
vi.mock('@/lib/auth/get-org-id', () => ({
  getManagerOrgId: () => getManagerOrgId(),
}));

const updateLead = vi.fn();
vi.mock('./update-lead', () => ({
  updateLead: (...args: unknown[]) => updateLead(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}));

import { reassignCloser } from './reassign-closer';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const CLOSER_NEW = '22222222-2222-2222-2222-222222222222';
const CLOSER_OLD = '33333333-3333-3333-3333-333333333333';

function builderWithMaybeSingle(data: unknown) {
  const b = createQueryBuilder();
  b.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  return b;
}

describe('reassignCloser', () => {
  beforeEach(() => {
    resetMocks();
    getManagerOrgId.mockReset();
    updateLead.mockReset();
    getManagerOrgId.mockResolvedValue({ orgId: 'org-1', userId: 'user-1', supabase: mockSupabase });
    updateLead.mockResolvedValue({ success: true, data: undefined });
  });

  it('rejects invalid input before any auth/db work', async () => {
    const result = await reassignCloser({ leadId: 'not-a-uuid', newCloserId: 'nope' });
    expect(result.success).toBe(false);
    expect(getManagerOrgId).not.toHaveBeenCalled();
  });

  it('rejects non-managers', async () => {
    getManagerOrgId.mockRejectedValue(new Error('redirect'));
    const result = await reassignCloser({ leadId: LEAD_ID, newCloserId: CLOSER_NEW });
    expect(result).toEqual({ success: false, error: 'Acesso restrito a gestores' });
  });

  it('fails when the new closer is not found in the org', async () => {
    mockFrom.mockImplementation(() => builderWithMaybeSingle(null)); // closers lookup → null
    const result = await reassignCloser({ leadId: LEAD_ID, newCloserId: CLOSER_NEW });
    expect(result).toEqual({ success: false, error: 'Closer não encontrado' });
  });

  it('is a no-op when the lead already has the chosen closer', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'closers') return builderWithMaybeSingle({ id: CLOSER_NEW, name: 'Jhonata' });
      if (table === 'leads') return builderWithMaybeSingle({ id: LEAD_ID, closer_id: CLOSER_NEW });
      return createQueryBuilder();
    });

    const result = await reassignCloser({ leadId: LEAD_ID, newCloserId: CLOSER_NEW });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.changed).toBe(false);
      expect(result.data.closerName).toBe('Jhonata');
    }
    expect(updateLead).not.toHaveBeenCalled();
  });

  it('reassigns and flags feedback repoint when a pending request exists', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'closers') return builderWithMaybeSingle({ id: CLOSER_NEW, name: 'Jhonata' });
      if (table === 'leads') return builderWithMaybeSingle({ id: LEAD_ID, closer_id: CLOSER_OLD });
      if (table === 'closer_feedback_requests') {
        const b = createQueryBuilder();
        // pending lookup for old closer resolves via thenable → one pending row
        b.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [{ id: 'req-old' }], error: null, count: null }).then(resolve);
        // "existing new" lookup uses maybeSingle → none
        b.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
        return b;
      }
      if (table === 'interactions') return builderWithMaybeSingle(null); // no meeting
      return createQueryBuilder();
    });

    const result = await reassignCloser({ leadId: LEAD_ID, newCloserId: CLOSER_NEW });

    expect(updateLead).toHaveBeenCalledWith(LEAD_ID, { closer_id: CLOSER_NEW });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.changed).toBe(true);
      expect(result.data.feedbackReassigned).toBe(true);
      expect(result.data.meetingInFuture).toBe(false);
    }
  });
});
