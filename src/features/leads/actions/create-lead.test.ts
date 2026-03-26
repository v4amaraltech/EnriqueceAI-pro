import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as any;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() =>
    Promise.resolve({ from: mockFrom }),
  ),
}));

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}));

const mockCreateNotifications = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotificationsForOrgMembers: (...args: unknown[]) => mockCreateNotifications(...args),
}));

const mockEnrollLeads = vi.fn();
vi.mock('@/features/cadences/actions/manage-cadences', () => ({
  enrollLeads: (...args: unknown[]) => mockEnrollLeads(...args),
}));

const mockEnrichLeadAction = vi.fn();
vi.mock('./enrich-lead', () => ({
  enrichLeadAction: (...args: unknown[]) => mockEnrichLeadAction(...args),
}));

import { revalidatePath } from 'next/cache';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createLead } from './create-lead';

// --- Chain helpers ---

function makeOrgMemberChain(orgId: string | null) {
  const singleMock = vi.fn().mockResolvedValue({ data: orgId ? { org_id: orgId } : null });
  const eqStatusMock = vi.fn().mockReturnValue({ single: singleMock });
  const eqUserMock = vi.fn().mockReturnValue({ eq: eqStatusMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
  return { select: selectMock };
}

function makeAssigneeChain(found: boolean) {
  const singleMock = vi.fn().mockResolvedValue({ data: found ? { user_id: 'user-2' } : null });
  const eqStatusMock = vi.fn().mockReturnValue({ single: singleMock });
  const eqOrgMock = vi.fn().mockReturnValue({ eq: eqStatusMock });
  const eqUserMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
  return { select: selectMock };
}

function makeInsertChain(leadId: string | null, error: { message: string } | null = null) {
  const singleMock = vi.fn().mockResolvedValue({
    data: leadId ? { id: leadId } : null,
    error,
  });
  const selectMock = vi.fn().mockReturnValue({ single: singleMock });
  const insertMock = vi.fn().mockReturnValue({ select: selectMock });
  return { insert: insertMock };
}

function makeSubscriptionChain(planId: string | null) {
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: planId ? { plan_id: planId } : null });
  const eqOrgMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
  return { select: selectMock };
}

function makePlanChain(maxLeads: number) {
  const singleMock = vi.fn().mockResolvedValue({ data: { max_leads: maxLeads } });
  const eqIdMock = vi.fn().mockReturnValue({ single: singleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqIdMock });
  return { select: selectMock };
}

function makeLeadCountChain(count: number) {
  const isMock = vi.fn().mockResolvedValue({ count });
  const eqOrgMock = vi.fn().mockReturnValue({ is: isMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
  return { select: selectMock };
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const CADENCE_UUID = '660e8400-e29b-41d4-a716-446655440000';

const validInput = {
  first_name: 'João',
  last_name: 'Silva',
  email: 'joao@empresa.com',
  telefone: '11999999999',
  empresa: 'Acme Ltda',
  job_title: 'Gerente Comercial',
  lead_source: 'outbound',
  assigned_to: VALID_UUID,
};

describe('createLead', () => {
  beforeEach(() => {
    resetMocks();
    mockCreateNotifications.mockClear();
    mockEnrollLeads.mockResolvedValue({ success: true, data: { enrolled: 1, errors: [] } });
    mockEnrichLeadAction.mockResolvedValue({ success: true, data: undefined });
  });

  it('should create a lead with all required fields', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null); // skip limit check
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('new-lead-id');
    }
    expect(revalidatePath).toHaveBeenCalledWith('/leads');
    expect(mockEnrichLeadAction).toHaveBeenCalledWith('new-lead-id');
    expect(mockEnrollLeads).not.toHaveBeenCalled();
  });

  it('should enroll in cadence with immediate mode', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead({
      ...validInput,
      cadence_id: CADENCE_UUID,
      enrollment_mode: 'immediate',
    });

    expect(result.success).toBe(true);
    expect(mockEnrollLeads).toHaveBeenCalledWith(CADENCE_UUID, ['new-lead-id'], 'active');
  });

  it('should enroll with scheduled start and update next_step_due', async () => {
    const scheduledDate = '2026-03-01T09:00:00.000Z';
    let callCount = 0;
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      if (callCount === 4) return makeInsertChain('new-lead-id');
      // 5th call: update enrollment next_step_due
      return { update: updateMock };
    });

    const result = await createLead({
      ...validInput,
      cadence_id: CADENCE_UUID,
      enrollment_mode: 'scheduled',
      scheduled_start: scheduledDate,
    });

    expect(result.success).toBe(true);
    expect(mockEnrollLeads).toHaveBeenCalledWith(CADENCE_UUID, ['new-lead-id'], 'active');
    expect(updateMock).toHaveBeenCalledWith({ next_step_due: scheduledDate });
  });

  it('should return error when org not found', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain(null));

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error when assigned_to is not in org', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      return makeAssigneeChain(false);
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Responsável não pertence à organização');
    }
  });

  it('should return error for invalid input (missing required fields)', async () => {
    const result = await createLead({ assigned_to: VALID_UUID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it('should succeed even when enrollment fails', async () => {
    mockEnrollLeads.mockRejectedValue(new Error('Enrollment error'));

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead({
      ...validInput,
      cadence_id: CADENCE_UUID,
    });

    expect(result.success).toBe(true);
  });

  it('should succeed even when enrichment fails', async () => {
    mockEnrichLeadAction.mockRejectedValue(new Error('Enrichment error'));

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(true);
  });

  it('should return error when DB insert fails', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain(null, { message: 'Insert failed' });
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao criar lead');
    }
  });

  it('should return LEAD_LIMIT_REACHED when max_leads exceeded', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain('plan-1');
      if (callCount === 3) return makePlanChain(100);
      return makeLeadCountChain(100); // at limit
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('LEAD_LIMIT_REACHED');
      expect(result.error).toContain('100/100');
    }
  });

  it('should allow creation when under lead limit', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain('plan-1');
      if (callCount === 3) return makePlanChain(100);
      if (callCount === 4) return makeLeadCountChain(50); // under limit
      if (callCount === 5) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(true);
  });

  it('should pass is_inbound flag through', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead({ ...validInput, is_inbound: true });

    expect(result.success).toBe(true);
  });

  describe('lead threshold alerts', () => {
    function makeServiceSupabase(existingNotification: unknown) {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: existingNotification });
      const limitMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const containsMock = vi.fn().mockReturnValue({ limit: limitMock });
      const ltMock = vi.fn().mockReturnValue({ contains: containsMock });
      const gteMock = vi.fn().mockReturnValue({ lt: ltMock });
      const eqTypeMock = vi.fn().mockReturnValue({ gte: gteMock });
      const eqOrgMock = vi.fn().mockReturnValue({ eq: eqTypeMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
      return { from: vi.fn().mockReturnValue({ select: selectMock }) };
    }

    it('should fire 80% threshold alert when crossing threshold', async () => {
      // 79 leads, max 100 → threshold=80. After creation: 80 → crosses
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeOrgMemberChain('org-1');
        if (callCount === 2) return makeSubscriptionChain('plan-1');
        if (callCount === 3) return makePlanChain(100);
        if (callCount === 4) return makeLeadCountChain(79);
        if (callCount === 5) return makeAssigneeChain(true);
        return makeInsertChain('new-lead-id');
      });

      // Dedup: no existing notification
      vi.mocked(createServiceRoleClient).mockReturnValue(
        makeServiceSupabase(null) as never,
      );

      await createLead(validInput);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          type: 'usage_limit_alert',
          metadata: expect.objectContaining({ channel: 'leads', used: 80, limit: 100 }),
          roleFilter: 'manager',
        }),
      );
    });

    it('should NOT fire alert when below threshold', async () => {
      // 50 leads, max 100 → threshold=80. After creation: 51 < 80 → no alert
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeOrgMemberChain('org-1');
        if (callCount === 2) return makeSubscriptionChain('plan-1');
        if (callCount === 3) return makePlanChain(100);
        if (callCount === 4) return makeLeadCountChain(50);
        if (callCount === 5) return makeAssigneeChain(true);
        return makeInsertChain('new-lead-id');
      });

      await createLead(validInput);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });

    it('should NOT fire alert when already above threshold', async () => {
      // 85 leads, max 100 → threshold=80. 85 >= 80 already → no crossing
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeOrgMemberChain('org-1');
        if (callCount === 2) return makeSubscriptionChain('plan-1');
        if (callCount === 3) return makePlanChain(100);
        if (callCount === 4) return makeLeadCountChain(85);
        if (callCount === 5) return makeAssigneeChain(true);
        return makeInsertChain('new-lead-id');
      });

      await createLead(validInput);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });

    it('should deduplicate: skip alert if already sent today', async () => {
      // Crosses threshold
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeOrgMemberChain('org-1');
        if (callCount === 2) return makeSubscriptionChain('plan-1');
        if (callCount === 3) return makePlanChain(100);
        if (callCount === 4) return makeLeadCountChain(79);
        if (callCount === 5) return makeAssigneeChain(true);
        return makeInsertChain('new-lead-id');
      });

      // Dedup: notification already exists
      vi.mocked(createServiceRoleClient).mockReturnValue(
        makeServiceSupabase({ id: 'existing-notif' }) as never,
      );

      await createLead(validInput);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });

    it('should NOT fire alert when no subscription found', async () => {
      // No subscription → hasLimitInfo stays false → no alert
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeOrgMemberChain('org-1');
        if (callCount === 2) return makeSubscriptionChain(null);
        if (callCount === 3) return makeAssigneeChain(true);
        return makeInsertChain('new-lead-id');
      });

      await createLead(validInput);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCreateNotifications).not.toHaveBeenCalled();
    });
  });
});
